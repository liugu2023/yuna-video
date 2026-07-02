// B站动态发布：复用扫码绑定的 cookie 直接调网页端接口（社区逆向，与投稿链路同源）。
// 纯文字：POST /x/dynamic/feed/create/dyn（scene=1）
// 带图：先逐张 POST /x/dynamic/feed/draw/upload_bfs 传到B站图床，再 create/dyn（scene=2）
import crypto from 'node:crypto'
import fs from 'node:fs'
import config from '../config.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export const MAX_TEXT_LEN = 1000
export const MAX_IMAGES = 9

class BiliApiError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}
export { BiliApiError }

function readCookies() {
  const data = JSON.parse(fs.readFileSync(config.biliup.cookieFile, 'utf8'))
  const cookies = data?.cookie_info?.cookies || []
  const map = Object.fromEntries(cookies.map((c) => [c.name, c.value]))
  let header = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  // cookie 里没有 buvid3 时 create/dyn 会额外返回一大坨 fake_card，补一个随机值即可
  if (!map.buvid3) header += `; buvid3=${crypto.randomUUID()}`
  return { header, csrf: map.bili_jct || '', mid: map.DedeUserID || '0' }
}

function biliHeaders(cookieHeader) {
  return {
    Cookie: cookieHeader,
    'User-Agent': UA,
    Referer: 'https://t.bilibili.com/',
    Origin: 'https://t.bilibili.com',
  }
}

// 常见错误码翻译成人话；-101 说明 cookie 失效，引导管理员重新绑定
function apiError(j, action) {
  const known = {
    '-101': 'B站登录态已失效，请管理员到「B站账号」页面检查或重新扫码绑定',
    '-111': 'csrf 校验失败，cookie 可能不完整，请重新扫码绑定',
    '-352': '触发B站风控，请稍后再试或降低发布频率',
    '-400': 'B站拒绝了请求（-400），登录凭据可能已失效或异常，请管理员重新扫码绑定',
  }
  return new BiliApiError(known[String(j.code)] || `${action}失败：${j.message || `错误码 ${j.code}`}`, j.code)
}

// 上传单张图片到B站图床，返回 { img_src, img_width, img_height, img_size }
export async function uploadImage({ buffer, filename, mimetype }) {
  const { header, csrf } = readCookies()
  const fd = new FormData()
  fd.append('file_up', new Blob([buffer], { type: mimetype }), filename)
  fd.append('category', 'daily')
  fd.append('biz', 'new_dyn')
  fd.append('csrf', csrf)

  const res = await fetch('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', {
    method: 'POST',
    headers: biliHeaders(header),
    body: fd,
  })
  const j = await res.json()
  if (j.code !== 0 || !j.data?.image_url) throw apiError(j, `图片「${filename}」上传`)
  return {
    img_src: j.data.image_url,
    img_width: j.data.image_width,
    img_height: j.data.image_height,
    img_size: buffer.length / 1024,
  }
}

// 发布动态；pics 为空时发纯文字。成功返回 { dynId }
export async function createDynamic({ text, pics = [] }) {
  const { header, csrf, mid } = readCookies()
  const dynReq = {
    content: { contents: [{ raw_text: text, type: 1, biz_id: '' }] },
    scene: pics.length ? 2 : 1,
    upload_id: `${mid}_${Math.floor(Date.now() / 1000)}_${Math.floor(1000 + Math.random() * 9000)}`,
    meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
  }
  if (pics.length) dynReq.pics = pics

  const res = await fetch(`https://api.bilibili.com/x/dynamic/feed/create/dyn?platform=web&csrf=${encodeURIComponent(csrf)}`, {
    method: 'POST',
    headers: { ...biliHeaders(header), 'Content-Type': 'application/json' },
    body: JSON.stringify({ dyn_req: dynReq }),
  })
  const j = await res.json()
  const dynId = j.data?.dyn_id_str || (j.data?.dyn_id ? String(j.data.dyn_id) : '')
  if (j.code !== 0 || !dynId) throw apiError(j, '动态发布')
  return { dynId }
}
