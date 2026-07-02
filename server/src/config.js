import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

// 可选配置文件 server/.env（KEY=VALUE 每行一条，支持 # 注释，模板见 .env.example）：
// 启动时读入环境变量；已存在的环境变量优先，命令行临时覆盖不受影响
const envFile = path.join(rootDir, '.env')
if (fs.existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(envFile, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export default {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'yuna-video-dev-secret-please-change',
  tokenExpiresIn: '7d',
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  uploadDir: path.join(rootDir, 'uploads'),
  webDist: path.resolve(rootDir, '../web/dist'),
  maxVideoSize: 8 * 1024 * 1024 * 1024, // 8GB，对齐B站单文件上限
  maxCoverSize: 10 * 1024 * 1024, // 10MB
  // biliup 自动投稿（可选）：两个文件都存在时，审核端出现“自动投稿到B站”功能
  // 二进制由 scripts/install-biliup.mjs 在 npm install 时按平台自动下载
  biliup: {
    bin:
      process.env.BILIUP_BIN ||
      path.join(rootDir, 'bin', process.platform === 'win32' ? 'biliup.exe' : 'biliup'),
    cookieFile: process.env.BILIUP_COOKIE || path.join(rootDir, 'data', 'cookies.json'),
  },
  // B站登录态保活：每 intervalHours 检查一次；失效或距上次续期超过 renewDays 时自动 renew
  bili: {
    intervalHours: Number(process.env.BILI_KEEPALIVE_HOURS || 12),
    renewDays: Number(process.env.BILI_RENEW_DAYS || 7),
  },
  // 邮件通知（可选）：配置 SMTP_USER + SMTP_PASS 后启用（QQ邮箱在设置→账户里开启SMTP拿授权码）
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
  // 平台对外访问地址（用于邮件里的审核链接，如 https://video.example.com），留空则不带链接
  siteUrl: (process.env.SITE_URL || '').replace(/\/+$/, ''),
}
