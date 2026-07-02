import { Router } from 'express'
import db, { transaction } from '../db.js'
import { auth } from '../middleware/auth.js'
import { notifySubmission } from '../lib/mailer.js'
import { ensurePreview } from '../lib/transcoder.js'
import {
  VIDEO_STATUSES,
  paginate,
  addLog,
  deleteUploadFile,
  parseVideoRow,
  getVideoWithNames,
  getVideoLogs,
  validateVideoPayload,
} from '../lib/helpers.js'

const router = Router()
router.use(auth)

const EDITABLE = ['draft', 'rejected']

function findOwnVideo(req, res) {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id)
  if (!video) {
    res.status(404).json({ error: '稿件不存在' })
    return null
  }
  const isOwner = video.user_id === req.user.id
  const isReviewer = ['reviewer', 'admin'].includes(req.user.role)
  if (!isOwner && !isReviewer) {
    res.status(403).json({ error: '无权访问该稿件' })
    return null
  }
  // 主席只能查看本部门的他人稿件（与审核接口一致；未分配部门的主席不受限）
  if (!isOwner && req.user.role === 'reviewer' && req.user.department) {
    const uploader = db.prepare('SELECT department FROM users WHERE id = ?').get(video.user_id)
    if (uploader?.department !== req.user.department) {
      res.status(403).json({ error: '该稿件属于其他部门，无权访问' })
      return null
    }
  }
  video._isOwner = isOwner
  return video
}

// 我的稿件列表
router.get('/', (req, res) => {
  const { page, pageSize, offset } = paginate(req)
  const { status, keyword } = req.query

  let where = 'WHERE user_id = ?'
  const params = [req.user.id]
  if (status && VIDEO_STATUSES.includes(status)) {
    where += ' AND status = ?'
    params.push(status)
  }
  if (keyword) {
    where += ' AND title LIKE ?'
    params.push(`%${keyword}%`)
  }

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM videos ${where}`).get(...params)
  const list = db
    .prepare(`SELECT * FROM videos ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset)
    .map(parseVideoRow)

  res.json({ list, total, page, pageSize })
})

// 新建稿件（草稿）
router.post('/', (req, res) => {
  const { error, data } = validateVideoPayload(req.body)
  if (error) return res.status(400).json({ error })

  const info = db
    .prepare(
      `INSERT INTO videos (user_id, title, description, tags, category, cover_path, video_path, video_name, video_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      data.title,
      data.description,
      data.tags,
      data.category,
      data.coverPath,
      data.videoPath,
      data.videoName,
      data.videoSize
    )

  ensurePreview(info.lastInsertRowid) // 后台探测编码，浏览器不支持时生成预览副本
  res.json(getVideoWithNames(info.lastInsertRowid))
})

// 稿件详情（本人或审核员）
router.get('/:id', (req, res) => {
  const video = findOwnVideo(req, res)
  if (!video) return
  res.json({ ...getVideoWithNames(video.id), logs: getVideoLogs(video.id) })
})

// 编辑稿件（仅草稿/被驳回状态，仅本人）
router.put('/:id', (req, res) => {
  const video = findOwnVideo(req, res)
  if (!video) return
  if (!video._isOwner) return res.status(403).json({ error: '只能编辑自己的稿件' })
  if (!EDITABLE.includes(video.status)) {
    return res.status(400).json({ error: '当前状态的稿件不可编辑' })
  }

  const { error, data } = validateVideoPayload(req.body)
  if (error) return res.status(400).json({ error })

  // 替换了视频/封面时清理旧文件；换视频后重新探测转码预览
  const videoChanged = data.videoPath !== video.video_path
  if (video.video_path && videoChanged) deleteUploadFile(video.video_path)
  if (video.cover_path && data.coverPath !== video.cover_path) deleteUploadFile(video.cover_path)
  if (videoChanged && video.preview_path) deleteUploadFile(video.preview_path)

  db.prepare(
    `UPDATE videos SET title = ?, description = ?, tags = ?, category = ?,
       cover_path = ?, video_path = ?, video_name = ?, video_size = ?,
       updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(
    data.title,
    data.description,
    data.tags,
    data.category,
    data.coverPath,
    data.videoPath,
    data.videoName,
    data.videoSize,
    video.id
  )
  if (videoChanged) {
    db.prepare(`UPDATE videos SET preview_path = '', preview_status = '' WHERE id = ?`).run(video.id)
    ensurePreview(video.id)
  }

  res.json(getVideoWithNames(video.id))
})

// 删除稿件（本人删草稿/驳回稿；管理员可删任意）
router.delete('/:id', (req, res) => {
  const video = findOwnVideo(req, res)
  if (!video) return

  const isAdmin = req.user.role === 'admin'
  if (!isAdmin && !(video._isOwner && EDITABLE.includes(video.status))) {
    return res.status(403).json({ error: '仅草稿或被驳回的稿件可以删除' })
  }

  transaction(() => {
    db.prepare('DELETE FROM review_logs WHERE video_id = ?').run(video.id)
    db.prepare('DELETE FROM videos WHERE id = ?').run(video.id)
  })
  deleteUploadFile(video.video_path)
  deleteUploadFile(video.cover_path)
  deleteUploadFile(video.preview_path)

  res.json({ ok: true })
})

// 提交审核
router.post('/:id/submit', (req, res) => {
  const video = findOwnVideo(req, res)
  if (!video) return
  if (!video._isOwner) return res.status(403).json({ error: '只能提交自己的稿件' })
  if (!EDITABLE.includes(video.status)) {
    return res.status(400).json({ error: '当前状态不可提交审核' })
  }
  if (!video.video_path) return res.status(400).json({ error: '请先上传视频文件' })

  db.prepare(
    `UPDATE videos SET status = 'pending', submitted_at = datetime('now','localtime'),
       updated_at = datetime('now','localtime'), reject_reason = '', reviewer_id = NULL, reviewed_at = NULL
     WHERE id = ?`
  ).run(video.id)
  addLog(video.id, req.user.id, 'submit', '提交审核')
  notifySubmission(video.id) // 异步邮件通知对应部门主席，不阻塞响应

  res.json(getVideoWithNames(video.id))
})

// 撤回审核
router.post('/:id/withdraw', (req, res) => {
  const video = findOwnVideo(req, res)
  if (!video) return
  if (!video._isOwner) return res.status(403).json({ error: '只能撤回自己的稿件' })
  if (video.status !== 'pending') return res.status(400).json({ error: '仅待审核的稿件可以撤回' })

  db.prepare(
    `UPDATE videos SET status = 'draft', updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(video.id)
  addLog(video.id, req.user.id, 'withdraw', '主动撤回')

  res.json(getVideoWithNames(video.id))
})

export default router
