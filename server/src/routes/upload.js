import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import crypto from 'node:crypto'
import config from '../config.js'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router()

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mov', '.flv', '.avi', '.wmv', '.webm', '.mkv', '.ts', '.mpg', '.mpeg'])
const COVER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

// multer 的 originalname 按 latin1 解码，中文文件名需要转回 utf8
function fixName(name) {
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8')
    return fixed.includes('�') ? name : fixed
  } catch {
    return name
  }
}

function makeUploader(subdir, extSet, maxSize, extError) {
  const storage = multer.diskStorage({
    destination: path.join(config.uploadDir, subdir),
    filename(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase()
      cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`)
    },
  })
  return multer({
    storage,
    limits: { fileSize: maxSize },
    fileFilter(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase()
      if (!extSet.has(ext)) return cb(new Error(extError))
      cb(null, true)
    },
  })
}

const videoUpload = makeUploader(
  'videos',
  VIDEO_EXTS,
  config.maxVideoSize,
  '不支持的视频格式（支持 mp4/mov/flv/avi/wmv/webm/mkv 等）'
)
const coverUpload = makeUploader('covers', COVER_EXTS, config.maxCoverSize, '封面仅支持 jpg/png/webp 格式')

function handleUpload(uploader, subdir, sizeError) {
  return (req, res) => {
    uploader.single('file')(req, res, (err) => {
      if (err) {
        const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        return res.status(tooBig ? 413 : 400).json({ error: tooBig ? sizeError : err.message })
      }
      if (!req.file) return res.status(400).json({ error: '未接收到文件' })
      res.json({
        path: `/uploads/${subdir}/${req.file.filename}`,
        name: fixName(req.file.originalname),
        size: req.file.size,
      })
    })
  }
}

// 未清理本地视频占用的总字节数（发布/删除稿件后文件即删、自动出账）
function usedVideoBytes() {
  return db.prepare("SELECT COALESCE(SUM(video_size), 0) AS used FROM videos WHERE video_path != ''").get().used
}

const gb = (n) => Math.round((n / 1024 ** 3) * 10) / 10

// 存储配额闸门：总量达到上限后暂停视频上传通道。放在 multer 之前，拒绝时不落盘
function checkVideoQuota(req, res, next) {
  const used = usedVideoBytes()
  if (used >= config.videoQuota) {
    return res.status(507).json({
      error: `平台存储空间已满（已占用 ${gb(used)} GB / 上限 ${gb(config.videoQuota)} GB），视频上传通道已暂停；稿件发布或删除后会自动释放空间`,
    })
  }
  next()
}

// 上传限制与配额占用（前端展示、预检用）
router.get('/config', auth, (req, res) => {
  res.json({ maxVideoSize: config.maxVideoSize, videoQuota: config.videoQuota, quotaUsed: usedVideoBytes() })
})

router.post('/video', auth, checkVideoQuota, handleUpload(videoUpload, 'videos', `视频超过单文件 ${gb(config.maxVideoSize)} GB 上限`))
router.post('/cover', auth, handleUpload(coverUpload, 'covers', '封面超过 10MB 上限'))

export default router
