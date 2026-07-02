// B站账号绑定与登录态保活。
// 登录方式说明：B站账密登录强制极验验证码，无法无人值守，因此不保存账号密码；
// 采用「TV端扫码登录一次（与 biliup login 相同的接口与凭据格式）→ refresh_token 定时自动续期」。
// cookie 文件与 biliup 完全兼容（server/data/cookies.json），自动投稿直接复用。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import config from '../config.js'

const TV_APPKEY = '4409e2ce8ffd12b8'
const TV_APPSEC = '59b43e04ad6965f34319062b478f83dd'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const STATE_FILE = path.join(config.dataDir, 'bili-keepalive.json')

let state = {
  lastCheckAt: null,
  lastCheckOk: null,
  lastCheckMsg: '尚未检查',
  lastRenewAt: null,
  lastRenewOk: null,
  uname: '',
  mid: 0,
}
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
} catch {}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch {}
}

export function getState() {
  return { ...state }
}

// B站 APP 接口签名：参数按 key 排序拼接 query，MD5(query + appsec)
function signedForm(params) {
  const p = { ...params, appkey: TV_APPKEY, ts: String(Math.floor(Date.now() / 1000)) }
  const qs = Object.keys(p)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`)
    .join('&')
  const sign = crypto.createHash('md5').update(qs + TV_APPSEC).digest('hex')
  return `${qs}&sign=${sign}`
}

async function postForm(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body,
  })
  return res.json()
}

// 生成TV端登录二维码（返回的 url 由前端渲染成二维码，手机B站App扫码确认）
export async function generateQrcode() {
  const j = await postForm(
    'https://passport.bilibili.com/x/passport-tv-login/qrcode/auth_code',
    signedForm({ local_id: '0' })
  )
  if (j.code !== 0 || !j.data?.auth_code) {
    return { error: `获取二维码失败：${j.message || j.code}` }
  }
  return { authCode: j.data.auth_code, url: j.data.url }
}

// 轮询扫码结果；成功后把凭据写成 biliup 兼容的 cookies.json
export async function pollQrcode(authCode) {
  const j = await postForm(
    'https://passport.bilibili.com/x/passport-tv-login/qrcode/poll',
    signedForm({ auth_code: String(authCode), local_id: '0' })
  )
  if (j.code === 0 && j.data?.token_info) {
    fs.mkdirSync(path.dirname(config.biliup.cookieFile), { recursive: true })
    fs.writeFileSync(config.biliup.cookieFile, JSON.stringify(j.data, null, 2))
    // 刚绑定的 token 是全新的，视为刚续期
    state.lastRenewAt = new Date().toISOString()
    state.lastRenewOk = true
    const check = await checkLogin()
    state.lastCheckAt = new Date().toISOString()
    state.lastCheckOk = check.isLogin
    state.lastCheckMsg = check.isLogin ? `绑定成功（${check.uname}）` : '绑定成功，但登录校验未通过'
    state.uname = check.uname
    state.mid = check.mid
    saveState()
    return { status: 'success', uname: check.uname, mid: check.mid }
  }
  if (j.code === 86039) return { status: 'waiting' } // 未扫码
  if (j.code === 86090) return { status: 'scanned' } // 已扫码待确认
  if (j.code === 86038) return { status: 'expired' } // 二维码已过期
  return { status: 'error', message: `${j.code} ${j.message || ''}`.trim() }
}

export function isBound() {
  return fs.existsSync(config.biliup.cookieFile)
}

export function cookieUpdatedAt() {
  try {
    return fs.statSync(config.biliup.cookieFile).mtime.toISOString()
  } catch {
    return null
  }
}

function cookieHeader() {
  const data = JSON.parse(fs.readFileSync(config.biliup.cookieFile, 'utf8'))
  const cookies = data?.cookie_info?.cookies || []
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

// 用官方 nav 接口校验 cookie 是否仍有效
export async function checkLogin() {
  if (!isBound()) return { bound: false, isLogin: false, uname: '', mid: 0 }
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { Cookie: cookieHeader(), 'User-Agent': UA, Referer: 'https://www.bilibili.com' },
    })
    const j = await res.json()
    const isLogin = j.code === 0 && Boolean(j.data?.isLogin)
    return { bound: true, isLogin, uname: j.data?.uname || '', mid: j.data?.mid || 0 }
  } catch (err) {
    return { bound: true, isLogin: false, uname: '', mid: 0, error: err.message }
  }
}

// 调 biliup renew 用 refresh_token 续期（无需密码、无验证码）
export function runBiliupRenew() {
  return new Promise((resolve) => {
    if (!fs.existsSync(config.biliup.bin)) {
      resolve({ ok: false, skipped: true, error: '未找到 biliup 可执行文件（在 server 目录运行 npm run biliup:install 下载），无法自动续期', lines: [] })
      return
    }
    const args = ['-u', config.biliup.cookieFile, 'renew']
    const isScript = /\.(mjs|cjs|js)$/i.test(config.biliup.bin)
    const cmd = isScript ? process.execPath : config.biliup.bin
    const cmdArgs = isScript ? [config.biliup.bin, ...args] : args

    const lines = []
    let child
    try {
      child = spawn(cmd, cmdArgs, { windowsHide: true })
    } catch (err) {
      resolve({ ok: false, error: `无法启动 biliup：${err.message}`, lines })
      return
    }
    const onData = (buf) => {
      for (const raw of buf.toString('utf8').split(/\r?\n/)) {
        const line = raw.trim()
        if (line) {
          lines.push(line)
          if (lines.length > 100) lines.shift()
        }
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => resolve({ ok: false, error: `biliup 进程错误：${err.message}`, lines }))
    child.on('close', (code) =>
      resolve(code === 0 ? { ok: true, lines } : { ok: false, error: `biliup renew 退出码 ${code}`, lines })
    )
  })
}

// 保活一轮：先 nav 校验；失效或距上次续期超过 renewDays 时执行 renew
export async function keepaliveTick(trigger = 'timer') {
  const now = () => new Date().toISOString()

  if (!isBound()) {
    state.lastCheckAt = now()
    state.lastCheckOk = false
    state.lastCheckMsg = '未绑定B站账号'
    saveState()
    return getState()
  }

  try {
    let check = await checkLogin()
    state.lastCheckAt = now()
    state.lastCheckOk = check.isLogin
    state.uname = check.uname || state.uname
    state.mid = check.mid || state.mid
    state.lastCheckMsg = check.isLogin ? `登录有效（${check.uname}）` : 'cookie 已失效'

    const renewDue =
      !state.lastRenewAt || Date.now() - Date.parse(state.lastRenewAt) > config.bili.renewDays * 86400_000

    if (!check.isLogin || renewDue) {
      const renew = await runBiliupRenew()
      if (!renew.skipped) {
        state.lastRenewAt = now()
        state.lastRenewOk = renew.ok
        if (renew.ok) {
          check = await checkLogin()
          state.lastCheckOk = check.isLogin
          state.lastCheckMsg = check.isLogin
            ? `已自动续期，登录有效（${check.uname}）`
            : '续期后登录校验仍未通过，请重新扫码绑定'
        } else {
          state.lastCheckMsg += `；自动续期失败：${renew.error}`
        }
      } else if (!check.isLogin) {
        state.lastCheckMsg += `；${renew.error}`
      }
    }
  } catch (err) {
    state.lastCheckAt = now()
    state.lastCheckOk = false
    state.lastCheckMsg = `检查异常：${err.message}`
  }

  saveState()
  console.log(`[bili-keepalive] (${trigger}) ${state.lastCheckMsg}`)
  return getState()
}

let timer = null
export function startKeepalive() {
  if (timer) return
  // 启动后稍等再跑第一轮，之后按固定间隔轮询
  setTimeout(() => keepaliveTick('startup'), 15_000)
  timer = setInterval(() => keepaliveTick('timer'), config.bili.intervalHours * 3600_000)
  timer.unref?.()
  console.log(
    `[bili-keepalive] 已启动：每 ${config.bili.intervalHours} 小时检查登录态，超过 ${config.bili.renewDays} 天或失效时自动续期`
  )
}
