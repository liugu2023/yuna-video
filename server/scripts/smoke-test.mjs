// 核心业务流程冒烟测试：node scripts/smoke-test.mjs（需要后端已在 3000 端口运行）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const uploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads')
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

console.log('== 2. 管理员创建普通成员（自助注册已关闭） ==')
const regClosed = await api('POST', '/auth/register', {
  body: { username: 'nobody', nickname: '路人', password: 'test123456' },
})
check('注册接口已关闭(404)', regClosed.status === 404)

const uname = `member_${Date.now().toString(36)}`
const createdUser = await api('POST', '/admin/users', {
  token: adminToken,
  body: { username: uname, nickname: '测试成员', password: 'test123456', role: 'member' },
})
check('管理员创建成员账号', createdUser.status === 200, JSON.stringify(createdUser.data))
const memberLogin = await api('POST', '/auth/login', { body: { username: uname, password: 'test123456' } })
check('成员登录并获得token', memberLogin.status === 200 && memberLogin.data.token, JSON.stringify(memberLogin.data))
const memberToken = memberLogin.data.token

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
check('发布后 video_path 已清空', published.data.video_path === '', published.data.video_path)
const localFile = path.join(uploadDir, up.data.path.slice('/uploads/'.length))
check('发布后本地视频文件已删除', !fs.existsSync(localFile), localFile)

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

const users = await api('GET', `/admin/users?keyword=${uname}&pageSize=100`, { token: adminToken })
check('成员列表可搜到新成员', users.data.list?.some((u) => u.username === uname))

const memberId = users.data.list.find((u) => u.username === uname)?.id
const promote = await api('PUT', `/admin/users/${memberId}`, { token: adminToken, body: { role: 'reviewer' } })
check('提升为审核员', promote.status === 200 && promote.data.role === 'reviewer')

const selfDemote = await api('PUT', `/admin/users/1`, { token: adminToken, body: { role: 'member' } })
check('管理员不能自降角色(400)', selfDemote.status === 400)

console.log('== 10. 部门管理与隔离 ==')
const ts = Date.now().toString(36)

const deptName = `测试部_${ts}`
const deptCreated = await api('POST', '/admin/departments', { token: adminToken, body: { name: deptName } })
check('创建部门', deptCreated.status === 200 && deptCreated.data.id, JSON.stringify(deptCreated.data))
const deptId = deptCreated.data.id
check(
  '重复创建部门被拒(409)',
  (await api('POST', '/admin/departments', { token: adminToken, body: { name: deptName } })).status === 409
)
const ghostDept = await api('POST', '/admin/users', {
  token: adminToken,
  body: { username: `dept_x_${ts}`, nickname: '幽灵', password: 'test123456', role: 'member', department: '不存在的部门' },
})
check('建号选字典外部门被拒(400)', ghostDept.status === 400, JSON.stringify(ghostDept.data))

const deptUser = await api('POST', '/admin/users', {
  token: adminToken,
  body: { username: `dept_t_${ts}`, nickname: '测试部员', password: 'test123456', role: 'member', department: deptName },
})
check('建号选字典内部门', deptUser.status === 200, JSON.stringify(deptUser.data))

const deptRenamed = `测试部改_${ts}`
const renamed = await api('PUT', `/admin/departments/${deptId}`, { token: adminToken, body: { name: deptRenamed } })
check('部门改名', renamed.status === 200 && renamed.data.name === deptRenamed, JSON.stringify(renamed.data))
const afterRename = await api('GET', `/admin/users?keyword=dept_t_${ts}`, { token: adminToken })
check(
  '改名同步成员部门',
  afterRename.data.list?.find((u) => u.username === `dept_t_${ts}`)?.department === deptRenamed,
  JSON.stringify(afterRename.data.list)
)

const delBusy = await api('DELETE', `/admin/departments/${deptId}`, { token: adminToken })
check('有成员的部门不可删(400)', delBusy.status === 400, JSON.stringify(delBusy.data))
await api('PUT', `/admin/users/${deptUser.data.id}`, { token: adminToken, body: { department: '' } })
const delOk = await api('DELETE', `/admin/departments/${deptId}`, { token: adminToken })
check('清空成员后可删除部门', delOk.status === 200, JSON.stringify(delOk.data))

// 隔离测试用的两个部门（历史数据里可能已存在，重复创建的 409 忽略即可）
for (const name of ['宣传部', '技术部']) {
  await api('POST', '/admin/departments', { token: adminToken, body: { name } })
}
for (const [u, nick, role, dept] of [
  [`dept_m_${ts}`, '宣传部长', 'member', '宣传部'],
  [`dept_r1_${ts}`, '技术主席', 'reviewer', '技术部'],
  [`dept_r2_${ts}`, '宣传主席', 'reviewer', '宣传部'],
]) {
  await api('POST', '/admin/users', {
    token: adminToken,
    body: { username: u, nickname: nick, password: 'test123456', role, department: dept },
  })
}
const tokenOf = async (u) =>
  (await api('POST', '/auth/login', { body: { username: u, password: 'test123456' } })).data.token
const mB = await tokenOf(`dept_m_${ts}`)
const r1 = await tokenOf(`dept_r1_${ts}`)
const r2 = await tokenOf(`dept_r2_${ts}`)

const form2 = new FormData()
form2.append('file', new Blob([new Uint8Array(512).fill(3)], { type: 'video/mp4' }), '部门测试.mp4')
const up2 = await api('POST', '/upload/video', { token: mB, form: form2 })
const created2 = await api('POST', '/videos', {
  token: mB,
  body: { title: '【测试】部门隔离稿件', tags: ['测试'], videoPath: up2.data.path, videoName: up2.data.name, videoSize: up2.data.size },
})
const vid2 = created2.data.id
await api('POST', `/videos/${vid2}/submit`, { token: mB })

const kw = encodeURIComponent('部门隔离')
const otherList = await api('GET', `/review/videos?keyword=${kw}`, { token: r1 })
check('外部门主席列表看不到稿件', !otherList.data.list?.some((v) => v.id === vid2))
check('外部门主席看详情被拒(403)', (await api('GET', `/review/videos/${vid2}`, { token: r1 })).status === 403)
check(
  '外部门主席审核被拒(403)',
  (await api('POST', `/review/videos/${vid2}/approve`, { token: r1, body: {} })).status === 403
)
const ownList = await api('GET', `/review/videos?keyword=${kw}`, { token: r2 })
check('本部门主席列表可见稿件', ownList.data.list?.some((v) => v.id === vid2))
check('列表返回部门字段', ownList.data.list?.find((v) => v.id === vid2)?.uploader_department === '宣传部')
const ap2 = await api('POST', `/review/videos/${vid2}/approve`, { token: r2, body: {} })
check('本部门主席可审核通过', ap2.status === 200 && ap2.data.status === 'approved')

console.log('== 11. 清理测试数据 ==')
const del = await api('DELETE', `/videos/${vid}`, { token: adminToken })
check('管理员删除测试稿件', del.status === 200)
const del2 = await api('DELETE', `/videos/${vid2}`, { token: adminToken })
check('删除部门隔离测试稿件', del2.status === 200)

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
process.exit(failed ? 1 : 0)
