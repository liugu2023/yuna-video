// 自动投稿（biliup）链路冒烟测试。
// 需要后端以 mock 配置启动：
//   BILIUP_BIN=<scripts/mock-biliup.mjs> BILIUP_COOKIE=<scripts/mock-cookies.json> node src/app.js
const BASE = process.env.BASE_URL || 'http://localhost:3000'
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

console.log('== 准备：登录并造一个已通过审核的稿件 ==')
const login = await api('POST', '/auth/login', { body: { username: 'admin', password: 'admin123456' } })
check('管理员登录', login.status === 200)
const token = login.data.token

const cfg = await api('GET', '/review/publish-config', { token })
check('自动投稿已启用（mock biliup）', cfg.data?.autoPublishEnabled === true, JSON.stringify(cfg.data))

const form = new FormData()
form.append('file', new Blob([new Uint8Array(2048).fill(7)], { type: 'video/mp4' }), '自动投稿测试.mp4')
const up = await api('POST', '/upload/video', { token, form })
const created = await api('POST', '/videos', {
  token,
  body: {
    title: '【测试】自动投稿链路',
    tags: ['测试', '协会'],
    category: '生活',
    videoPath: up.data.path,
    videoName: up.data.name,
    videoSize: up.data.size,
  },
})
const vid = created.data.id
await api('POST', `/videos/${vid}/submit`, { token })
const approved = await api('POST', `/review/videos/${vid}/approve`, { token, body: {} })
check('稿件已通过审核', approved.data?.status === 'approved')

console.log('== 参数校验 ==')
const noTags = await api('POST', `/review/videos/${vid}/auto-publish`, { token, body: { tid: 21, tags: [] } })
check('无标签被拒(400)', noTags.status === 400)
const badTid = await api('POST', `/review/videos/${vid}/auto-publish`, { token, body: { tid: 'abc', tags: ['x'] } })
check('非法tid被拒(400)', badTid.status === 400)

console.log('== 发起自动投稿 ==')
const start = await api('POST', `/review/videos/${vid}/auto-publish`, { token, body: { tid: 21, tags: ['测试', '协会'] } })
check('任务启动', start.status === 200 && start.data.status === 'running', JSON.stringify(start.data))
const jobId = start.data.id

const dup = await api('POST', `/review/videos/${vid}/auto-publish`, { token, body: { tid: 21, tags: ['测试'] } })
check('同稿件重复发起返回同一任务', dup.status === 200 && dup.data.id === jobId)

let job = null
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  const res = await api('GET', `/review/publish-jobs/${jobId}`, { token })
  job = res.data
  if (job.status !== 'running') break
}
check('任务执行成功', job?.status === 'succeeded', JSON.stringify(job))
check('识别到BV号', job?.bvid === 'BV1mk4y1z7XX', job?.bvid)

console.log('== 回填结果 ==')
const detail = await api('GET', `/videos/${vid}`, { token })
check(
  '稿件自动置为已发布并回填BV号',
  detail.data.status === 'published' && detail.data.bilibili_bvid === 'BV1mk4y1z7XX',
  `${detail.data.status} ${detail.data.bilibili_bvid}`
)
check(
  '发布日志已记录',
  detail.data.logs?.some((l) => l.action === 'publish' && l.comment.includes('自动投稿')),
  JSON.stringify(detail.data.logs?.map((l) => l.comment))
)

const again = await api('POST', `/review/videos/${vid}/auto-publish`, { token, body: { tid: 21, tags: ['x'] } })
check('已发布稿件不能再次投稿(400)', again.status === 400)

console.log('== 清理 ==')
const del = await api('DELETE', `/videos/${vid}`, { token })
check('删除测试稿件', del.status === 200)

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
process.exit(failed ? 1 : 0)
