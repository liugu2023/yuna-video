// B站账号绑定与登录态保活链路冒烟测试。
// 需要后端以 mock 配置启动（注意 cookie 指向独立的临时文件，测试会写入并在末尾解绑删除）：
//   BILIUP_BIN=<scripts/mock-biliup.mjs 绝对路径> BILIUP_COOKIE=<server/data/smoke-cookies.json 绝对路径> node src/app.js
// 然后运行：node scripts/smoke-bili.mjs
// 说明：二维码与登录校验会真实访问B站公开接口（不登录、不投稿），需要联网。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const COOKIE_FILE = process.env.SMOKE_COOKIE || path.resolve(__dirname, '../data/smoke-cookies.json')

let passed = 0
let failed = 0

function check(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✔ ${name}`)
  } else {
    failed++
    console.log(`  ✘ ${name} ${extra}`)
  }
}

async function api(method, path, { token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {}
  return { status: res.status, data }
}

console.log('== 准备：写入 biliup 格式的假 cookie（登录校验必然失败，用于验证保活兜底路径） ==')
fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true })
fs.writeFileSync(
  COOKIE_FILE,
  JSON.stringify({
    cookie_info: {
      cookies: [
        { name: 'SESSDATA', value: 'smoke-fake-sessdata' },
        { name: 'bili_jct', value: 'smoke-fake-jct' },
        { name: 'DedeUserID', value: '1' },
      ],
    },
    token_info: { access_token: 'smoke-fake-at', refresh_token: 'smoke-fake-rt' },
  }, null, 2)
)
console.log(`  cookie 文件：${COOKIE_FILE}`)

console.log('== 权限控制 ==')
const anon = await api('GET', '/bili/status')
check('未登录访问被拒(401)', anon.status === 401, `got ${anon.status}`)

const login = await api('POST', '/auth/login', { body: { username: 'admin', password: 'admin123456' } })
check('管理员登录', login.status === 200)
const token = login.data?.token

const memberName = `smoke_bili_${Date.now() % 100000}`
await api('POST', '/auth/register', { body: { username: memberName, nickname: 'B站冒烟', password: 'smoke123456' } })
const memberLogin = await api('POST', '/auth/login', { body: { username: memberName, password: 'smoke123456' } })
const memberToken = memberLogin.data?.token
const memberAccess = await api('GET', '/bili/status', { token: memberToken })
check('非管理员访问被拒(403)', memberAccess.status === 403, `got ${memberAccess.status}`)

console.log('== 绑定状态 ==')
const st = await api('GET', '/bili/status', { token })
check('status 返回 bound=true', st.status === 200 && st.data?.bound === true, JSON.stringify(st.data))
check('status 返回 cookie 更新时间', Boolean(st.data?.cookieUpdatedAt))
check('status 返回保活配置', st.data?.intervalHours > 0 && st.data?.renewDays > 0)
check('status 返回 biliup 就绪(mock)', st.data?.biliupBinExists === true)

console.log('== 扫码绑定（真实B站接口，仅生成二维码不登录） ==')
const qr = await api('POST', '/bili/qrcode', { token })
check('生成二维码', qr.status === 200 && Boolean(qr.data?.authCode) && Boolean(qr.data?.url), JSON.stringify(qr.data))
if (qr.status === 200) {
  const poll = await api('POST', '/bili/qrcode/poll', { token, body: { authCode: qr.data.authCode } })
  check('轮询未扫码返回 waiting', poll.data?.status === 'waiting', JSON.stringify(poll.data))
}
const pollNoCode = await api('POST', '/bili/qrcode/poll', { token, body: {} })
check('轮询缺 authCode 被拒(400)', pollNoCode.status === 400)

console.log('== 保活检查与续期（假 cookie：校验失败→自动触发 mock renew） ==')
const chk = await api('POST', '/bili/check', { token })
check('check 返回最新状态', chk.status === 200 && Boolean(chk.data?.lastCheckAt), JSON.stringify(chk.data))
check('假 cookie 登录校验为失效', chk.data?.lastCheckOk === false, chk.data?.lastCheckMsg)
check('已自动尝试续期(mock 成功)', chk.data?.lastRenewOk === true, JSON.stringify(chk.data))

const renew = await api('POST', '/bili/renew', { token })
check('手动续期执行成功(mock)', renew.status === 200 && renew.data?.ok === true, JSON.stringify(renew.data))
check('续期后登录校验仍为失效（假 cookie 符合预期）', renew.data?.isLogin === false)

console.log('== 解绑 ==')
const unbind = await api('DELETE', '/bili/binding', { token })
check('解绑成功', unbind.status === 200 && unbind.data?.ok === true)
check('cookie 文件已删除', !fs.existsSync(COOKIE_FILE))
const st2 = await api('GET', '/bili/status', { token })
check('解绑后 bound=false', st2.data?.bound === false)
const renew2 = await api('POST', '/bili/renew', { token })
check('未绑定时续期被拒(400)', renew2.status === 400)

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
process.exit(failed ? 1 : 0)
