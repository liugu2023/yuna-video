import './lib/logger.js' // 必须最先导入：给后续所有 console 输出加时间戳
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import config from './config.js'
import './db.js'
import authRoutes from './routes/auth.js'
import uploadRoutes from './routes/upload.js'
import videoRoutes from './routes/videos.js'
import reviewRoutes from './routes/review.js'
import adminRoutes from './routes/admin.js'
import statsRoutes from './routes/stats.js'
import biliRoutes from './routes/bili.js'
import { startKeepalive } from './lib/bili-account.js'
import { isMailConfigured } from './lib/mailer.js'
import { sweepPublishedVideos } from './lib/helpers.js'
import { recoverPreviews } from './lib/transcoder.js'

const app = express()
app.disable('x-powered-by')
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// 上传文件静态服务（express.static 原生支持 Range，视频可拖动进度条）
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }))
app.use('/uploads', (req, res) => res.status(404).json({ error: '文件不存在' }))

// API 请求日志：方法 路径 状态码 耗时 用户ID（healthcheck 的 GET /api 探活除外）
app.use('/api', (req, res, next) => {
  if (req.originalUrl === '/api') return next()
  const start = Date.now()
  res.on('finish', () => {
    const user = req.user ? `user#${req.user.id}` : '-'
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms ${user}`)
  })
  next()
})

app.use('/api/auth', authRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/videos', videoRoutes)
app.use('/api/review', reviewRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/stats', statsRoutes)
app.use('/api/bili', biliRoutes)
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }))

// 生产部署：若前端已构建，则由本服务直接托管 web/dist
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist))
  app.get('*', (req, res) => res.sendFile(path.join(config.webDist, 'index.html')))
}

// 兜底错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err)
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' })
})

const server = app.listen(config.port, () => {
  console.log(`[server] 后端服务已启动: http://localhost:${config.port}`)
  console.log(`[server] 上传目录: ${config.uploadDir}`)
  console.log(
    isMailConfigured()
      ? `[mail] 邮件通知已启用：SMTP ${config.smtp.host}:${config.smtp.port}，发件人 ${config.smtp.from}`
      : '[mail] 邮件通知未启用（在 server/.env 配置 SMTP_USER + SMTP_PASS 后开启）'
  )
})

// 大视频上传耗时较长，关闭请求超时限制
server.requestTimeout = 0

// B站登录态定时保活
startKeepalive()

// 清理历史遗留：已发布稿件的本地视频文件（发布成功后即删，这里兜底）
sweepPublishedVideos()

// 预览转码：恢复被重启打断的任务，补扫历史稿件
recoverPreviews()
