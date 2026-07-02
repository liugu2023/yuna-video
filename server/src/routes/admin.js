import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { auth, requireRole } from '../middleware/auth.js'
import { paginate } from '../lib/helpers.js'
import { validateAccountFields } from './auth.js'

const router = Router()
router.use(auth, requireRole('admin'))

const ROLES = ['member', 'reviewer', 'admin']

// 成员列表
router.get('/users', (req, res) => {
  const { page, pageSize, offset } = paginate(req)
  const { keyword } = req.query

  let where = 'WHERE 1 = 1'
  const params = []
  if (keyword) {
    where += ' AND (username LIKE ? OR nickname LIKE ?)'
    const like = `%${keyword}%`
    params.push(like, like)
  }

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM users ${where}`).get(...params)
  const list = db
    .prepare(
      `SELECT id, username, nickname, role, status, created_at,
              (SELECT COUNT(*) FROM videos WHERE videos.user_id = users.id) AS video_count
       FROM users ${where} ORDER BY id ASC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)

  res.json({ list, total, page, pageSize })
})

// 创建成员账号
router.post('/users', (req, res) => {
  const { username, nickname, password, role } = req.body || {}

  const err = validateAccountFields({ username, nickname, password })
  if (err) return res.status(400).json({ error: err })
  if (!ROLES.includes(role)) return res.status(400).json({ error: '角色不合法' })

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (exists) return res.status(409).json({ error: '用户名已存在' })

  const info = db
    .prepare('INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?)')
    .run(username, bcrypt.hashSync(String(password), 10), String(nickname).trim(), role)

  res.json(
    db
      .prepare('SELECT id, username, nickname, role, status, created_at FROM users WHERE id = ?')
      .get(info.lastInsertRowid)
  )
})

// 修改成员（昵称/角色/状态）
router.put('/users/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: '用户不存在' })

  const updates = {}
  const { nickname, role, status } = req.body || {}

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

  res.json(
    db.prepare('SELECT id, username, nickname, role, status, created_at FROM users WHERE id = ?').get(target.id)
  )
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
