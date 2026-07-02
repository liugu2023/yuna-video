import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

export default {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'yuna-video-dev-secret-please-change',
  tokenExpiresIn: '7d',
  // 邀请码：设置环境变量 INVITE_CODE 后，注册时必须填写；为空则开放注册
  inviteCode: process.env.INVITE_CODE || '',
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
}
