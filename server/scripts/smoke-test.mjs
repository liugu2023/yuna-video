// 核心业务流程冒烟测试：node scripts/smoke-test.mjs（需要后端已在 3000 端口运行）
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

console.log('== 1. 登录管理员 ==')
const adminLogin = await api('POST', '/auth/login', {
  body: { username: 'admin', password: 'admin123456' },
})
check('管理员登录', adminLogin.status === 200 && adminLogin.data.token)
const adminToken = adminLogin.data.token

console.log('== 2. 注册普通成员 ==')
const uname = `member_${Date.now().toString(36)}`
const reg = await api('POST', '/auth/register', {
  body: { username: uname, nickname: '测试成员', password: 'test123456' },
})
check('注册并获得token', reg.status === 200 && reg.data.token, JSON.stringify(reg.data))
const memberToken = reg.data.token

console.log('== 3. 成员上传视频文件 ==')
const form = new FormData()
form.append('file', new Blob([new Uint8Array(1024).fill(1)], { type: 'video/mp4' }), '测试视频.mp4')
const up = await api('POST', '/upload/video', { token: memberToken, form })
check('上传视频', up.status === 200 && up.data.path?.startsWith('/uploads/videos/'), JSON.stringify(up.data))
check('中文文件名正常', up.data.name === '测试视频.mp4', up.data.name)

console.log('== 4. 创建稿件并提交审核 ==')
const created = await api('POST', '/videos', {
  token: memberToken,
  body: {
    title: '【测试】协会周年庆剪辑',
    description: '冒烟测试稿件',
    tags: ['测试', '协会'],
    category: '生活',
    videoPath: up.data.path,
    videoName: up.data.name,
    videoSize: up.data.size,
  },
})
check('创建草稿', created.status === 200 && created.data.status === 'draft', JSON.stringify(created.data))
const vid = created.data.id

const submitted = await api('POST', `/videos/${vid}/submit`, { token: memberToken })
check('提交审核', submitted.status === 200 && submitted.data.status === 'pending')

console.log('== 5. 权限校验 ==')
const forbidden = await api('GET', '/review/videos', { token: memberToken })
check('普通成员访问审核接口被拒(403)', forbidden.status === 403)

console.log('== 6. 管理员审核 ==')
const queue = await api('GET', '/review/videos?status=pending', { token: adminToken })
check('待审核队列包含该稿件', queue.data.list?.some((v) => v.id === vid))

const rejectNoReason = await api('POST', `/review/videos/${vid}/reject`, { token: adminToken, body: {} })
check('驳回不填原因被拒(400)', rejectNoReason.status === 400)

const approved = await api('POST', `/review/videos/${vid}/approve`, {
  token: adminToken,
  body: { comment: '内容合规，通过' },
})
check('审核通过', approved.status === 200 && approved.data.status === 'approved')

console.log('== 7. 标记发布 ==')
const badBv = await api('POST', `/review/videos/${vid}/publish`, { token: adminToken, body: { bvid: 'not-a-bv' } })
check('非法BV号被拒(400)', badBv.status === 400)

const published = await api('POST', `/review/videos/${vid}/publish`, {
  token: adminToken,
  body: { bvid: 'BV1xx411c7XX' },
})
check('标记发布成功', published.status === 200 && published.data.status === 'published')

console.log('== 8. 详情与日志 ==')
const detail = await api('GET', `/videos/${vid}`, { token: memberToken })
check('成员可见最终状态', detail.data.status === 'published' && detail.data.bilibili_bvid === 'BV1xx411c7XX')
check(
  '日志完整（提交/通过/发布）',
  ['submit', 'approve', 'publish'].every((a) => detail.data.logs?.some((l) => l.action === a)),
  JSON.stringify(detail.data.logs?.map((l) => l.action))
)

console.log('== 9. 统计与成员管理 ==')
const dash = await api('GET', '/stats/dashboard', { token: adminToken })
check('工作台统计返回全站数据', dash.status === 200 && dash.data.site && dash.data.userCount >= 2)

const users = await api('GET', '/admin/users', { token: adminToken })
check('成员列表包含新成员', users.data.list?.some((u) => u.username === uname))

const memberId = users.data.list.find((u) => u.username === uname).id
const promote = await api('PUT', `/admin/users/${memberId}`, { token: adminToken, body: { role: 'reviewer' } })
check('提升为审核员', promote.status === 200 && promote.data.role === 'reviewer')

const selfDemote = await api('PUT', `/admin/users/1`, { token: adminToken, body: { role: 'member' } })
check('管理员不能自降角色(400)', selfDemote.status === 400)

console.log('== 10. 清理测试数据 ==')
const del = await api('DELETE', `/videos/${vid}`, { token: adminToken })
check('管理员删除测试稿件', del.status === 200)

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
process.exit(failed ? 1 : 0)
