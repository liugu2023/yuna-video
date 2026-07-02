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
import { sweepPublishedVideos } from './lib/helpers.js'

const app = express()
app.disable('x-powered-by')
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// 上传文件静态服务（express.static 原生支持 Range，视频可拖动进度条）
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }))
app.use('/uploads', (req, res) => res.status(404).json({ error: '文件不存在' }))

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
})

// 大视频上传耗时较长，关闭请求超时限制
server.requestTimeout = 0

// B站登录态定时保活
startKeepalive()

// 清理历史遗留：已发布稿件的本地视频文件（发布成功后即删，这里兜底）
sweepPublishedVideos()
