import jwt from 'jsonwebtoken'
import db from '../db.js'
import config from '../config.js'

export function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return res.status(401).json({ error: '未登录或登录已过期' })

  let payload
  try {
    payload = jwt.verify(token, config.jwtSecret)
  } catch {
    return res.status(401).json({ error: '未登录或登录已过期' })
  }

  const user = db
    .prepare('SELECT id, username, nickname, role, status, created_at FROM users WHERE id = ?')
    .get(payload.id)
  if (!user) return res.status(401).json({ error: '账号不存在' })
  if (user.status !== 'active') return res.status(403).json({ error: '账号已被禁用，请联系管理员' })

  req.user = user
  next()
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' })
    }
    next()
  }
}
