import { Router } from 'express'
import fs from 'node:fs'
import multer from 'multer'
import db from '../db.js'
import config from '../config.js'
import { auth, requireRole } from '../middleware/auth.js'
import { isConfigured } from '../lib/publisher.js'
import {
  generateQrcode,
  pollQrcode,
  isBound,
  cookieUpdatedAt,
  checkLogin,
  runBiliupRenew,
  keepaliveTick,
  getState,
} from '../lib/bili-account.js'
import { uploadImage, createDynamic, BiliApiError, MAX_TEXT_LEN, MAX_IMAGES } from '../lib/bili-dynamic.js'

const router = Router()
router.use(auth)

// ---- 动态发布（审核员 + 管理员）----
const canPost = requireRole('reviewer', 'admin')

// 图片不落盘，直接从内存转发到B站图床；B站动态图片仅支持 jpg/png/gif
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: MAX_IMAGES },
  fileFilter(req, file, cb) {
    if (!/^image\/(jpeg|png|gif)$/.test(file.mimetype)) {
      return cb(new Error('动态图片仅支持 jpg/png/gif 格式'))
    }
    cb(null, true)
  },
})

// 发布页需要的最小状态（审核员无权访问 /status，单独给一个轻量接口）
router.get('/dynamic/state', canPost, (req, res) => {
  const state = getState()
  res.json({ bound: isBound(), uname: state.uname, lastCheckOk: state.lastCheckOk })
})

// 发布历史（最近50条）
router.get('/dynamic/history', canPost, (req, res) => {
  const list = db
    .prepare(
      `SELECT d.id, d.text, d.image_count, d.dyn_id, d.created_at, u.nickname AS user_nickname
       FROM dynamics d LEFT JOIN users u ON u.id = d.user_id
       ORDER BY d.id DESC LIMIT 50`
    )
    .all()
  res.json({ list })
})

// 发布动态：multipart，字段 text + images[]（0-9张）
router.post('/dynamic', canPost, (req, res) => {
  imageUpload.array('images', MAX_IMAGES)(req, res, async (err) => {
    if (err) {
      const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
      const tooMany = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT'
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? '单张图片不能超过 20MB' : tooMany ? `图片最多 ${MAX_IMAGES} 张` : err.message,
      })
    }
    try {
      if (!isBound()) return res.status(400).json({ error: '尚未绑定B站账号，请联系管理员在「B站账号」页面扫码绑定' })
      const text = String(req.body?.text ?? '').trim()
      if (!text) return res.status(400).json({ error: '动态正文不能为空' })
      if (text.length > MAX_TEXT_LEN) return res.status(400).json({ error: `正文不能超过 ${MAX_TEXT_LEN} 字` })

      // 逐张上传，避免并发触发风控
      const pics = []
      for (const file of req.files || []) {
        pics.push(await uploadImage({ buffer: file.buffer, filename: file.originalname, mimetype: file.mimetype }))
      }
      const { dynId } = await createDynamic({ text, pics })

      db.prepare('INSERT INTO dynamics (user_id, text, image_count, dyn_id) VALUES (?, ?, ?, ?)').run(
        req.user.id, text, pics.length, dynId
      )
      res.json({ dynId, url: `https://t.bilibili.com/${dynId}` })
    } catch (e) {
      if (e instanceof BiliApiError) return res.status(502).json({ error: e.message })
      console.error('[bili-dynamic]', e)
      res.status(500).json({ error: `发布失败：${e.message}` })
    }
  })
})

// ---- 以下为账号绑定与保活管理（仅管理员）----
router.use(requireRole('admin'))

// 绑定与保活总览
router.get('/status', (req, res) => {
  res.json({
    bound: isBound(),
    cookieUpdatedAt: cookieUpdatedAt(),
    biliupBinExists: fs.existsSync(config.biliup.bin),
    autoPublishEnabled: isConfigured(),
    keepalive: getState(),
    intervalHours: config.bili.intervalHours,
    renewDays: config.bili.renewDays,
  })
})

// 生成TV端登录二维码
router.post('/qrcode', async (req, res, next) => {
  try {
    const result = await generateQrcode()
    if (result.error) return res.status(502).json({ error: result.error })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// 轮询扫码结果
router.post('/qrcode/poll', async (req, res, next) => {
  try {
    const authCode = String(req.body?.authCode ?? '').trim()
    if (!authCode) return res.status(400).json({ error: '缺少 authCode' })
    res.json(await pollQrcode(authCode))
  } catch (err) {
    next(err)
  }
})

// 立即执行一轮保活检查（nav 校验 + 按需续期）
router.post('/check', async (req, res, next) => {
  try {
    res.json(await keepaliveTick('manual'))
  } catch (err) {
    next(err)
  }
})

// 手动强制续期
router.post('/renew', async (req, res, next) => {
  try {
    if (!isBound()) return res.status(400).json({ error: '尚未绑定B站账号' })
    const renew = await runBiliupRenew()
    const check = await checkLogin()
    res.json({ ok: renew.ok, error: renew.error || '', lastLines: renew.lines.slice(-8), isLogin: check.isLogin, uname: check.uname })
  } catch (err) {
    next(err)
  }
})

// 解绑（删除 cookie 文件）
router.delete('/binding', (req, res) => {
  if (isBound()) fs.unlinkSync(config.biliup.cookieFile)
  res.json({ ok: true })
})

export default router
