import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import crypto from 'node:crypto'
import config from '../config.js'
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

function handleUpload(uploader, subdir) {
  return (req, res) => {
    uploader.single('file')(req, res, (err) => {
      if (err) {
        const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        return res.status(tooBig ? 413 : 400).json({ error: tooBig ? '文件超过大小限制' : err.message })
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

router.post('/video', auth, handleUpload(videoUpload, 'videos'))
router.post('/cover', auth, handleUpload(coverUpload, 'covers'))

export default router
