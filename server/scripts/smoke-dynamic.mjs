// B站动态发布链路冒烟测试（不会真的发出动态：用假 cookie 验证到B站接口的完整链路与错误处理）。
// 需要后端以 mock 配置启动（cookie 指向独立临时文件）：
//   BILIUP_BIN=<scripts/mock-biliup.mjs 绝对路径> BILIUP_COOKIE=<server/data/smoke-cookies.json 绝对路径> node src/app.js
// 然后运行：node scripts/smoke-dynamic.mjs（需联网，会真实请求B站接口但因 cookie 无效必然被拒）
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

async function api(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: form ? form : body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {}
  return { status: res.status, data }
}

function dynForm(text, images = []) {
  const fd = new FormData()
  fd.append('text', text)
  for (const [i, img] of images.entries()) {
    fd.append('images', new Blob([img.bytes], { type: img.type }), img.name || `img${i}.png`)
  }
  return fd
}

console.log('== 准备账号 ==')
const login = await api('POST', '/auth/login', { body: { username: 'admin', password: 'admin123456' } })
check('管理员登录', login.status === 200)
const token = login.data?.token

const suffix = Date.now() % 100000
await api('POST', '/admin/users', {
  token,
  body: { username: `smoke_rev_${suffix}`, nickname: '动态冒烟审核员', password: 'smoke123456', role: 'reviewer' },
})
const revLogin = await api('POST', '/auth/login', { body: { username: `smoke_rev_${suffix}`, password: 'smoke123456' } })
const revToken = revLogin.data?.token
check('审核员登录', revLogin.status === 200)

await api('POST', '/auth/register', { body: { username: `smoke_mem_${suffix}`, nickname: '动态冒烟成员', password: 'smoke123456' } })
const memLogin = await api('POST', '/auth/login', { body: { username: `smoke_mem_${suffix}`, password: 'smoke123456' } })
const memToken = memLogin.data?.token

console.log('== 权限控制 ==')
check('未登录被拒(401)', (await api('GET', '/bili/dynamic/state')).status === 401)
check('成员被拒(403)', (await api('GET', '/bili/dynamic/state', { token: memToken })).status === 403)
check('审核员可查状态', (await api('GET', '/bili/dynamic/state', { token: revToken })).status === 200)
check('管理员可查状态', (await api('GET', '/bili/dynamic/state', { token })).status === 200)
check('成员发动态被拒(403)', (await api('POST', '/bili/dynamic', { token: memToken, form: dynForm('测试') })).status === 403)

console.log('== 未绑定与参数校验 ==')
fs.rmSync(COOKIE_FILE, { force: true })
const st = await api('GET', '/bili/dynamic/state', { token: revToken })
check('未绑定时 bound=false', st.data?.bound === false, JSON.stringify(st.data))
const unbound = await api('POST', '/bili/dynamic', { token: revToken, form: dynForm('测试动态') })
check('未绑定发布被拒(400)', unbound.status === 400 && unbound.data?.error?.includes('绑定'), JSON.stringify(unbound.data))

// 写入假 cookie（结构合法但凭据无效）
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
    token_info: { access_token: 'fake', refresh_token: 'fake' },
  })
)

check('空正文被拒(400)', (await api('POST', '/bili/dynamic', { token: revToken, form: dynForm('   ') })).status === 400)
check(
  '超长正文被拒(400)',
  (await api('POST', '/bili/dynamic', { token: revToken, form: dynForm('字'.repeat(1001)) })).status === 400
)
const badType = await api('POST', '/bili/dynamic', {
  token: revToken,
  form: dynForm('测试', [{ bytes: new Uint8Array(64), type: 'image/webp', name: 'a.webp' }]),
})
check('webp 图片被拒(400)', badType.status === 400 && badType.data?.error?.includes('jpg'), JSON.stringify(badType.data))
const tooMany = await api('POST', '/bili/dynamic', {
  token: revToken,
  form: dynForm('测试', Array.from({ length: 10 }, (_, i) => ({ bytes: new Uint8Array(64), type: 'image/png', name: `p${i}.png` }))),
})
check('超过9张图被拒(400)', tooMany.status === 400, JSON.stringify(tooMany.data))
const tooBig = await api('POST', '/bili/dynamic', {
  token: revToken,
  form: dynForm('测试', [{ bytes: new Uint8Array(21 * 1024 * 1024), type: 'image/png', name: 'big.png' }]),
})
check('单张超20MB被拒(413)', tooBig.status === 413, JSON.stringify(tooBig.data))

console.log('== 假 cookie 走真实B站接口（预期被B站拒绝并映射为 502） ==')
const fake = await api('POST', '/bili/dynamic', { token: revToken, form: dynForm('冒烟测试动态（不会发出）') })
check(
  'B站拒绝映射为 502 且提示重新绑定',
  fake.status === 502 && /绑定|失效/.test(fake.data?.error || ''),
  JSON.stringify(fake.data)
)

console.log('== 发布历史 ==')
const hist = await api('GET', '/bili/dynamic/history', { token: revToken })
check('历史接口返回列表', hist.status === 200 && Array.isArray(hist.data?.list))
check('失败的发布不入库', !hist.data.list.some((d) => d.text?.includes('冒烟测试动态')))

console.log('== 清理 ==')
fs.rmSync(COOKIE_FILE, { force: true })
console.log('  已删除临时 cookie 文件')

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
process.exit(failed ? 1 : 0)
