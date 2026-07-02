import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db, { transaction } from '../db.js'
import { auth, requireRole } from '../middleware/auth.js'
import { paginate } from '../lib/helpers.js'
import { validateAccountFields } from './auth.js'

const router = Router()
router.use(auth, requireRole('admin'))

const ROLES = ['member', 'reviewer', 'admin']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USER_FIELDS = 'id, username, nickname, role, status, email, department, created_at'

// 校验可选的邮箱/部门字段，返回错误信息或 null
function validateProfileFields({ email, department }) {
  if (email !== undefined && email !== '' && (!EMAIL_RE.test(String(email)) || String(email).length > 100)) {
    return '邮箱格式不正确'
  }
  if (department !== undefined) {
    const name = String(department).trim()
    if (name && !db.prepare('SELECT id FROM departments WHERE name = ?').get(name)) {
      return '部门不存在，请先在「部门管理」中添加'
    }
  }
  return null
}

// ---- 部门管理：字典由管理员维护，成员建号/编辑时从中选择 ----

function validDeptName(raw) {
  const name = String(raw ?? '').trim()
  return name && name.length <= 20 ? name : null
}

router.get('/departments', (req, res) => {
  const list = db
    .prepare(
      `SELECT d.id, d.name, (SELECT COUNT(*) FROM users WHERE users.department = d.name) AS memberCount
       FROM departments d ORDER BY d.name`
    )
    .all()
  res.json({ list })
})

router.post('/departments', (req, res) => {
  const name = validDeptName(req.body?.name)
  if (!name) return res.status(400).json({ error: '部门名称需为1-20个字符' })
  if (db.prepare('SELECT id FROM departments WHERE name = ?').get(name)) {
    return res.status(409).json({ error: '该部门已存在' })
  }
  const info = db.prepare('INSERT INTO departments (name) VALUES (?)').run(name)
  res.json({ id: info.lastInsertRowid, name })
})

// 改名同步更新所有成员的部门（审核隔离与邮件通知都按名称匹配）
router.put('/departments/:id', (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id)
  if (!dept) return res.status(404).json({ error: '部门不存在' })

  const name = validDeptName(req.body?.name)
  if (!name) return res.status(400).json({ error: '部门名称需为1-20个字符' })
  if (name === dept.name) return res.json({ id: dept.id, name })
  if (db.prepare('SELECT id FROM departments WHERE name = ?').get(name)) {
    return res.status(409).json({ error: '该部门已存在；如需合并，请先把成员转移过去再删除本部门' })
  }

  transaction(() => {
    db.prepare('UPDATE departments SET name = ? WHERE id = ?').run(name, dept.id)
    db.prepare('UPDATE users SET department = ? WHERE department = ?').run(name, dept.name)
  })
  res.json({ id: dept.id, name })
})

router.delete('/departments/:id', (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id)
  if (!dept) return res.status(404).json({ error: '部门不存在' })

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users WHERE department = ?').get(dept.name)
  if (n > 0) return res.status(400).json({ error: `仍有 ${n} 名成员属于该部门，请先在成员列表中转移或清空他们的部门` })

  db.prepare('DELETE FROM departments WHERE id = ?').run(dept.id)
  res.json({ ok: true })
})

// 成员列表
router.get('/users', (req, res) => {
  const { page, pageSize, offset } = paginate(req)
  const { keyword } = req.query

  let where = 'WHERE 1 = 1'
  const params = []
  if (keyword) {
    where += ' AND (username LIKE ? OR nickname LIKE ? OR department LIKE ?)'
    const like = `%${keyword}%`
    params.push(like, like, like)
  }

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM users ${where}`).get(...params)
  const list = db
    .prepare(
      `SELECT ${USER_FIELDS},
              (SELECT COUNT(*) FROM videos WHERE videos.user_id = users.id) AS video_count
       FROM users ${where} ORDER BY id ASC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)

  res.json({ list, total, page, pageSize })
})

// 创建成员账号
router.post('/users', (req, res) => {
  const { username, nickname, password, role, email, department } = req.body || {}

  const err = validateAccountFields({ username, nickname, password }) || validateProfileFields({ email, department })
  if (err) return res.status(400).json({ error: err })
  if (!ROLES.includes(role)) return res.status(400).json({ error: '角色不合法' })

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (exists) return res.status(409).json({ error: '用户名已存在' })

  const info = db
    .prepare('INSERT INTO users (username, password_hash, nickname, role, email, department) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      username,
      bcrypt.hashSync(String(password), 10),
      String(nickname).trim(),
      role,
      String(email ?? '').trim(),
      String(department ?? '').trim()
    )

  res.json(db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(info.lastInsertRowid))
})

// 修改成员（昵称/角色/状态/邮箱/部门）
router.put('/users/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: '用户不存在' })

  const updates = {}
  const { nickname, role, status, email, department } = req.body || {}

  const profileErr = validateProfileFields({ email, department })
  if (profileErr) return res.status(400).json({ error: profileErr })

  if (nickname !== undefined) {
    const nick = String(nickname).trim()
    if (!nick || nick.length > 20) return res.status(400).json({ error: '昵称需为1-20个字符' })
    updates.nickname = nick
  }
  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: '角色不合法' })
    updates.role = role
  }
  if (status !== undefined) {
    if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: '状态不合法' })
    updates.status = status
  }
  if (email !== undefined) updates.email = String(email).trim()
  if (department !== undefined) updates.department = String(department).trim()

  // 防止管理员把自己降级/禁用导致失去入口
  if (target.id === req.user.id) {
    if (updates.role && updates.role !== 'admin') {
      return res.status(400).json({ error: '不能修改自己的角色' })
    }
    if (updates.status && updates.status !== 'active') {
      return res.status(400).json({ error: '不能禁用自己的账号' })
    }
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: '没有需要修改的内容' })

  const setClause = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(', ')
  db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...Object.values(updates), target.id)

  res.json(db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(target.id))
})

// 重置成员密码
router.post('/users/:id/reset-password', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: '用户不存在' })

  const pwd = String(req.body?.password ?? '')
  if (pwd.length < 6 || pwd.length > 64) return res.status(400).json({ error: '密码长度需为6-64位' })

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pwd, 10), target.id)
  res.json({ ok: true })
})

export default router
