import { Router } from 'express'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router()
router.use(auth)

function countByStatus(where, params) {
  const rows = db.prepare(`SELECT status, COUNT(*) AS c FROM videos ${where} GROUP BY status`).all(...params)
  const out = { total: 0, draft: 0, pending: 0, approved: 0, rejected: 0, published: 0 }
  for (const r of rows) {
    out[r.status] = r.c
    out.total += r.c
  }
  return out
}

router.get('/dashboard', (req, res) => {
  const isReviewer = ['reviewer', 'admin'].includes(req.user.role)

  const result = {
    role: req.user.role,
    mine: countByStatus('WHERE user_id = ?', [req.user.id]),
  }

  if (isReviewer) {
    result.site = countByStatus('', [])
    result.site.todayReviewed = db
      .prepare(
        `SELECT COUNT(*) AS c FROM review_logs
         WHERE action IN ('approve', 'reject') AND created_at >= date('now','localtime')`
      )
      .get().c
  }
  if (req.user.role === 'admin') {
    result.userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
  }

  // 最近动态：普通成员看自己相关的，审核员/管理员看全站
  const logWhere = isReviewer ? '' : 'WHERE v.user_id = ? OR l.operator_id = ?'
  const logParams = isReviewer ? [] : [req.user.id, req.user.id]
  result.recentLogs = db
    .prepare(
      `SELECT l.*, u.nickname AS operator_nickname, v.title AS video_title, v.user_id AS video_user_id
       FROM review_logs l
       LEFT JOIN users u ON u.id = l.operator_id
       LEFT JOIN videos v ON v.id = l.video_id
       ${logWhere}
       ORDER BY l.id DESC LIMIT 10`
    )
    .all(...logParams)

  res.json(result)
})

export default router
