import path from 'node:path'
import fs from 'node:fs'
import config from '../config.js'
import db from '../db.js'

export const VIDEO_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'published']

// 只允许引用本服务生成的上传文件路径，防止路径注入
export const SAFE_UPLOAD_PATH = /^\/uploads\/(videos|covers)\/[A-Za-z0-9._-]+$/

export function paginate(req, defaultSize = 10) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || defaultSize))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

export function addLog(videoId, operatorId, action, comment = '') {
  db.prepare(
    'INSERT INTO review_logs (video_id, operator_id, action, comment) VALUES (?, ?, ?, ?)'
  ).run(videoId, operatorId, action, comment)
}

export function deleteUploadFile(relPath) {
  if (!relPath || !SAFE_UPLOAD_PATH.test(relPath)) return
  const abs = path.join(config.uploadDir, relPath.slice('/uploads/'.length))
  fs.unlink(abs, () => {})
}

// 发布成功后删除本地视频文件以节约磁盘（封面保留用于平台内展示，稿件记录不动）。
// 删除成功（或文件已不存在）才清空 video_path；失败时保留路径，交给下次启动的兜底清扫重试。
export function cleanupPublishedVideo(videoId) {
  const video = db.prepare('SELECT video_path FROM videos WHERE id = ?').get(videoId)
  const relPath = video?.video_path
  if (!relPath || !SAFE_UPLOAD_PATH.test(relPath)) return false
  try {
    fs.unlinkSync(path.join(config.uploadDir, relPath.slice('/uploads/'.length)))
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[cleanup] 删除已发布稿件 #${videoId} 的视频文件失败：${err.message}`)
      return false
    }
  }
  db.prepare(`UPDATE videos SET video_path = '' WHERE id = ?`).run(videoId)
  return true
}

// 启动兜底：清理仍残留本地视频文件的已发布稿件（功能上线前的历史数据、或上次删除失败）
export function sweepPublishedVideos() {
  const rows = db.prepare(`SELECT id FROM videos WHERE status = 'published' AND video_path != ''`).all()
  let n = 0
  for (const { id } of rows) if (cleanupPublishedVideo(id)) n++
  if (n) console.log(`[cleanup] 启动清扫：已清理 ${n} 个已发布稿件的本地视频文件`)
}

export function parseVideoRow(row) {
  if (!row) return row
  let tags = []
  try {
    tags = JSON.parse(row.tags || '[]')
  } catch {
    tags = []
  }
  return { ...row, tags }
}

export function getVideoWithNames(id) {
  const row = db
    .prepare(
      `SELECT v.*, u.nickname AS uploader_nickname, u.username AS uploader_username,
              r.nickname AS reviewer_nickname
       FROM videos v
       JOIN users u ON u.id = v.user_id
       LEFT JOIN users r ON r.id = v.reviewer_id
       WHERE v.id = ?`
    )
    .get(id)
  return parseVideoRow(row)
}

export function getVideoLogs(videoId) {
  return db
    .prepare(
      `SELECT l.*, u.nickname AS operator_nickname
       FROM review_logs l
       LEFT JOIN users u ON u.id = l.operator_id
       WHERE l.video_id = ?
       ORDER BY l.id DESC`
    )
    .all(videoId)
}

// 校验并规范化稿件表单，返回 { error } 或 { data }
export function validateVideoPayload(body = {}) {
  const title = String(body.title ?? '').trim()
  if (!title) return { error: '标题不能为空' }
  if (title.length > 80) return { error: '标题不能超过80个字符' }

  const description = String(body.description ?? '').trim()
  if (description.length > 2000) return { error: '简介不能超过2000个字符' }

  const category = String(body.category ?? '').trim()
  if (category.length > 20) return { error: '分区名称过长' }

  let tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : []
  tags = [...new Set(tags)]
  if (tags.length > 10) return { error: '标签最多10个' }
  if (tags.some((t) => t.length > 20)) return { error: '单个标签不能超过20个字符' }

  const coverPath = String(body.coverPath ?? '').trim()
  if (coverPath && !SAFE_UPLOAD_PATH.test(coverPath)) return { error: '封面路径不合法' }

  const videoPath = String(body.videoPath ?? '').trim()
  if (videoPath && !SAFE_UPLOAD_PATH.test(videoPath)) return { error: '视频路径不合法' }

  const videoName = String(body.videoName ?? '').trim().slice(0, 200)
  const sizeNum = Number(body.videoSize)
  const videoSize = Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0

  return {
    data: {
      title,
      description,
      tags: JSON.stringify(tags),
      category,
      coverPath,
      videoPath,
      videoName,
      videoSize,
    },
  }
}
