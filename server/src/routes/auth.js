import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import config from '../config.js'
import { auth } from '../middleware/auth.js'

const router = Router()

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/

export function validateAccountFields({ username, nickname, password }) {
  if (!USERNAME_RE.test(String(username ?? ''))) {
    return '用户名需为3-20位字母、数字或下划线'
  }
  const nick = String(nickname ?? '').trim()
  if (!nick || nick.length > 20) return '昵称需为1-20个字符'
  const pwd = String(password ?? '')
  if (pwd.length < 6 || pwd.length > 64) return '密码长度需为6-64位'
  return null
}

function safeUser(u) {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    role: u.role,
    status: u.status,
    created_at: u.created_at,
  }
}

function signToken(user) {
  return jwt.sign({ id: user.id }, config.jwtSecret, { expiresIn: config.tokenExpiresIn })
}

// 注册页需要知道是否要填邀请码
router.get('/config', (req, res) => {
  res.json({ inviteRequired: Boolean(config.inviteCode) })
})

router.post('/register', (req, res) => {
  const { username, nickname, password, inviteCode } = req.body || {}

  const err = validateAccountFields({ username, nickname, password })
  if (err) return res.status(400).json({ error: err })

  if (config.inviteCode && String(inviteCode ?? '') !== config.inviteCode) {
    return res.status(400).json({ error: '邀请码不正确' })
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (exists) return res.status(409).json({ error: '用户名已存在' })

  const info = db
    .prepare('INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?)')
    .run(username, bcrypt.hashSync(String(password), 10), String(nickname).trim(), 'member')

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  res.json({ token: signToken(user), user: safeUser(user) })
})

router.post('/login', (req, res) => {
  const { username, password } = req.body || {}
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? ''))
  if (!user || !bcrypt.compareSync(String(password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: '账号已被禁用，请联系管理员' })
  }
  res.json({ token: signToken(user), user: safeUser(user) })
})

router.get('/me', auth, (req, res) => {
  res.json(req.user)
})

router.put('/password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {}
  const pwd = String(newPassword ?? '')
  if (pwd.length < 6 || pwd.length > 64) {
    return res.status(400).json({ error: '新密码长度需为6-64位' })
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!bcrypt.compareSync(String(oldPassword ?? ''), user.password_hash)) {
    return res.status(400).json({ error: '原密码不正确' })
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pwd, 10), req.user.id)
  res.json({ ok: true })
})

export default router
