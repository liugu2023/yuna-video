// B站合集（新版合集/SEASON）管理：复用扫码绑定的 cookie 调创作中心接口。
// 自动投稿成功后可将稿件加入指定合集；接口与 biliup 上传链路同源（社区逆向）。
import fs from 'node:fs'
import config from '../config.js'
import { BiliApiError } from './bili-dynamic.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function readCookies() {
  const data = JSON.parse(fs.readFileSync(config.biliup.cookieFile, 'utf8'))
  const cookies = data?.cookie_info?.cookies || []
  return {
    header: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    csrf: cookies.find((c) => c.name === 'bili_jct')?.value || '',
  }
}

function apiError(j, action) {
  const known = {
    '-101': 'B站登录态已失效，请管理员到「B站账号」页面检查或重新扫码绑定',
    '-111': 'csrf 校验失败，cookie 可能不完整，请重新扫码绑定',
    '-352': '触发B站风控，请稍后再试',
  }
  return new BiliApiError(known[String(j.code)] || `${action}失败：${j.message || `错误码 ${j.code}`}`, j.code)
}

async function biliGet(url, action) {
  const { header } = readCookies()
  const res = await fetch(url, {
    headers: { Cookie: header, 'User-Agent': UA, Referer: 'https://member.bilibili.com/' },
  })
  const j = await res.json()
  if (j.code !== 0) throw apiError(j, action)
  return j.data
}

// 合集列表（供投稿时下拉选择）；每个合集至少有一个默认小节，添加视频要用小节ID
export async function listSeasons() {
  const data = await biliGet(
    'https://member.bilibili.com/x2/creative/web/seasons?pn=1&ps=50&order=mtime&sort=desc&draft=1',
    '获取合集列表'
  )
  return (data?.seasons || [])
    .map((s) => ({
      id: s.season?.id,
      title: s.season?.title || `合集${s.season?.id}`,
      sectionId: s.sections?.sections?.[0]?.id,
      epCount: s.sections?.sections?.reduce((n, x) => n + (x.epCount || 0), 0) || 0,
    }))
    .filter((s) => s.id && s.sectionId)
}

// BV号 → aid 本地换算（B站2022后的编码算法），免去依赖接口
export function bv2av(bvid) {
  const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf'
  const c = bvid.split('')
  ;[c[3], c[9]] = [c[9], c[3]]
  ;[c[4], c[7]] = [c[7], c[4]]
  let tmp = 0n
  for (const ch of c.slice(3).join('')) tmp = tmp * 58n + BigInt(ALPHABET.indexOf(ch))
  return Number((tmp & 2251799813685247n) ^ 23442827791579n)
}

// 查询自己稿件的 cid（创作中心接口，审核中的稿件也能查到）。
// 刚投稿完B站入库有延迟，带重试。
async function resolveArchive(aid, { attempts = 5, delayMs = 3000 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs))
    try {
      const data = await biliGet(`https://member.bilibili.com/x/web/archive/videos?aid=${aid}`, '查询稿件信息')
      const cid = data?.videos?.[0]?.cid
      if (cid) return { cid, title: data.archive?.title || '' }
      lastErr = new BiliApiError('稿件尚未生成分P信息', 0)
    } catch (err) {
      lastErr = err
      // 登录态失效等硬错误没有重试意义
      if (err instanceof BiliApiError && [-101, -111].includes(err.code)) throw err
    }
  }
  throw lastErr
}

// 添加视频到合集小节
async function addEpisode({ aid, cid, title, sectionId }) {
  const { header, csrf } = readCookies()
  const res = await fetch(
    `https://member.bilibili.com/x2/creative/web/season/section/episodes/add?csrf=${encodeURIComponent(csrf)}`,
    {
      method: 'POST',
      headers: {
        Cookie: header,
        'User-Agent': UA,
        Referer: 'https://member.bilibili.com/',
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ sectionId, episodes: [{ aid, cid, title, charging_pay: 0 }], csrf }),
    }
  )
  const j = await res.json()
  if (j.code !== 0) throw apiError(j, '添加到合集')
}

// 投稿成功后按 BV号 加入合集：aid 优先用 biliup 输出解析结果，否则本地换算
export async function addVideoToSeason({ bvid, aid, title, sectionId }) {
  const realAid = aid || bv2av(bvid)
  const archive = await resolveArchive(realAid)
  await addEpisode({ aid: realAid, cid: archive.cid, title: archive.title || title, sectionId })
}
