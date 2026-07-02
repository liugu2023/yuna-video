import { Router } from 'express'
import db from '../db.js'
import { auth, requireRole } from '../middleware/auth.js'
import {
  VIDEO_STATUSES,
  paginate,
  addLog,
  parseVideoRow,
  getVideoWithNames,
  getVideoLogs,
  cleanupPublishedVideo,
} from '../lib/helpers.js'
import { isConfigured, startPublishJob, getJob, serializeJob } from '../lib/publisher.js'

const router = Router()
router.use(auth, requireRole('reviewer', 'admin'))

// 主席（审核员）只能审本部门的稿件；未分配部门的主席可看全部（兼容老账号），管理员不受限
function deptScope(reqUser) {
  return reqUser.role === 'reviewer' && reqUser.department ? reqUser.department : null
}

// 全站稿件列表（审核视角）
router.get('/videos', (req, res) => {
  const { page, pageSize, offset } = paginate(req)
  const { status, keyword } = req.query

  let where = 'WHERE 1 = 1'
  const params = []
  const dept = deptScope(req.user)
  if (dept) {
    where += ' AND u.department = ?'
    params.push(dept)
  }
  if (status && VIDEO_STATUSES.includes(status)) {
    where += ' AND v.status = ?'
    params.push(status)
  }
  if (keyword) {
    where += ' AND (v.title LIKE ? OR u.nickname LIKE ? OR u.username LIKE ?)'
    const like = `%${keyword}%`
    params.push(like, like, like)
  }

  // 待审核队列按提交时间先后排序，其余按最近更新排序
  const order =
    status === 'pending' ? 'ORDER BY v.submitted_at ASC, v.id ASC' : 'ORDER BY v.updated_at DESC, v.id DESC'

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM videos v JOIN users u ON u.id = v.user_id ${where}`)
    .get(...params)
  const list = db
    .prepare(
      `SELECT v.*, u.nickname AS uploader_nickname, u.username AS uploader_username, u.department AS uploader_department
       FROM videos v JOIN users u ON u.id = v.user_id
       ${where} ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)
    .map(parseVideoRow)

  res.json({ list, total, page, pageSize })
})

// 稿件审核详情
router.get('/videos/:id', (req, res) => {
  const video = getVideoWithNames(req.params.id)
  if (!video) return res.status(404).json({ error: '稿件不存在' })
  const dept = deptScope(req.user)
  if (dept && video.uploader_department !== dept) {
    return res.status(403).json({ error: '该稿件属于其他部门，无权查看' })
  }
  res.json({ ...video, logs: getVideoLogs(video.id) })
})

function loadVideo(req, res, expectedStatus, statusError) {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id)
  if (!video) {
    res.status(404).json({ error: '稿件不存在' })
    return null
  }
  const dept = deptScope(req.user)
  if (dept) {
    const uploader = db.prepare('SELECT department FROM users WHERE id = ?').get(video.user_id)
    if (uploader?.department !== dept) {
      res.status(403).json({ error: '该稿件属于其他部门，无权操作' })
      return null
    }
  }
  if (video.status !== expectedStatus) {
    res.status(400).json({ error: statusError })
    return null
  }
  return video
}

// 审核通过
router.post('/videos/:id/approve', (req, res) => {
  const video = loadVideo(req, res, 'pending', '该稿件不在待审核状态')
  if (!video) return

  db.prepare(
    `UPDATE videos SET status = 'approved', reviewer_id = ?, reviewed_at = datetime('now','localtime'),
       updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(req.user.id, video.id)
  addLog(video.id, req.user.id, 'approve', String(req.body?.comment ?? '').trim() || '审核通过')

  res.json(getVideoWithNames(video.id))
})

// 驳回
router.post('/videos/:id/reject', (req, res) => {
  const video = loadVideo(req, res, 'pending', '该稿件不在待审核状态')
  if (!video) return

  const comment = String(req.body?.comment ?? '').trim()
  if (!comment) return res.status(400).json({ error: '驳回时必须填写原因' })
  if (comment.length > 500) return res.status(400).json({ error: '驳回原因不能超过500字' })

  db.prepare(
    `UPDATE videos SET status = 'rejected', reject_reason = ?, reviewer_id = ?,
       reviewed_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(comment, req.user.id, video.id)
  addLog(video.id, req.user.id, 'reject', comment)

  res.json(getVideoWithNames(video.id))
})

// 是否启用了 biliup 自动投稿
router.get('/publish-config', (req, res) => {
  res.json({ autoPublishEnabled: isConfigured() })
})

// 发起自动投稿（biliup）
router.post('/videos/:id/auto-publish', (req, res) => {
  if (!isConfigured()) {
    return res.status(400).json({ error: '服务端未配置 biliup（需要 biliup 可执行文件与B站账号 cookie），请使用人工回填BV号' })
  }
  const video = loadVideo(req, res, 'approved', '仅审核通过的稿件可以自动投稿')
  if (!video) return

  const tid = Number(req.body?.tid)
  if (!Number.isInteger(tid) || tid < 1 || tid > 99999) {
    return res.status(400).json({ error: '请填写有效的B站分区ID（tid）' })
  }
  let tags = Array.isArray(req.body?.tags) ? req.body.tags.map((t) => String(t).trim()).filter(Boolean) : []
  tags = [...new Set(tags)].slice(0, 10)
  if (!tags.length) return res.status(400).json({ error: 'B站投稿至少需要1个标签' })
  if (tags.some((t) => t.length > 20)) return res.status(400).json({ error: '单个标签不能超过20个字符' })

  const { error, job } = startPublishJob(parseVideoRow(video), req.user, { tid, tags })
  if (error) return res.status(409).json({ error })
  res.json(serializeJob(job))
})

// 查询自动投稿任务状态
router.get('/publish-jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId)
  if (!job) return res.status(404).json({ error: '任务不存在（服务可能已重启），请重新发起' })
  res.json(serializeJob(job))
})

// 标记已发布到B站（填写BV号）
router.post('/videos/:id/publish', (req, res) => {
  const video = loadVideo(req, res, 'approved', '仅审核通过的稿件可以标记发布')
  if (!video) return

  const bvid = String(req.body?.bvid ?? '').trim()
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
    return res.status(400).json({ error: 'BV号格式不正确（示例：BV1xx411c7XX）' })
  }

  db.prepare(
    `UPDATE videos SET status = 'published', bilibili_bvid = ?,
       published_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(bvid, video.id)
  const cleaned = cleanupPublishedVideo(video.id)
  addLog(video.id, req.user.id, 'publish', `已发布至B站：${bvid}${cleaned ? '；本地视频文件已清理' : ''}`)

  res.json(getVideoWithNames(video.id))
})

export default router
