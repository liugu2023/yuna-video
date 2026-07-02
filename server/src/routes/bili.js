import { Router } from 'express'
import fs from 'node:fs'
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

const router = Router()
router.use(auth, requireRole('admin'))

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
