// 邮件通知：部长提交稿件审核时，立即通知对应部门的主席（审核员）。
// 配置 SMTP_USER + SMTP_PASS 后启用；未配置时所有函数静默跳过，不影响主流程。
import nodemailer from 'nodemailer'
import config from '../config.js'
import db from '../db.js'

let transporter = null

export function isMailConfigured() {
  return Boolean(config.smtp.user && config.smtp.pass)
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    })
  }
  return transporter
}

// 提交审核后调用（不 await，失败只记日志不影响提交）。
// 收件人：与部长同部门的主席 + 未分配部门的主席（兼容）；一个都没有则兜底通知管理员。
export async function notifySubmission(videoId) {
  if (!isMailConfigured()) return
  try {
    const video = db
      .prepare(
        `SELECT v.*, u.nickname AS uploader_nickname, u.department AS uploader_department
         FROM videos v JOIN users u ON u.id = v.user_id WHERE v.id = ?`
      )
      .get(videoId)
    if (!video || video.status !== 'pending') {
      console.warn(`[mail] 稿件 #${videoId} 跳过通知：${!video ? '稿件不存在' : `状态为 ${video.status}，非待审核`}`)
      return
    }

    let recipients = db
      .prepare(
        `SELECT email FROM users
         WHERE role = 'reviewer' AND status = 'active' AND email != ''
           AND (department = ? OR department = '')`
      )
      .all(video.uploader_department)
    if (!recipients.length) {
      recipients = db
        .prepare(`SELECT email FROM users WHERE role = 'admin' AND status = 'active' AND email != ''`)
        .all()
    }
    if (!recipients.length) {
      console.warn(
        `[mail] 稿件 #${videoId} 跳过通知：主席和管理员都没有填邮箱（后台「用户管理」给审核人补上邮箱后生效）`
      )
      return
    }

    const dept = video.uploader_department || '未分组'
    const link = config.siteUrl ? `${config.siteUrl}/review/${video.id}` : ''
    const subject = `【投稿审核】${dept} · ${video.uploader_nickname} 提交了新稿件`
    const text = [
      `${video.uploader_nickname}（${dept}）提交了稿件，等待审核：`,
      '',
      `标题：${video.title}`,
      video.category ? `分区：${video.category}` : '',
      `提交时间：${video.submitted_at}`,
      '',
      link ? `审核入口：${link}` : '请登录平台，在「审核中心」处理。',
    ]
      .filter(Boolean)
      .join('\n')

    const to = recipients.map((r) => r.email).join(', ')
    console.log(`[mail] 稿件 #${videoId} 发送通知 → ${to}`)
    const info = await getTransporter().sendMail({
      from: `"投稿审核平台" <${config.smtp.from}>`,
      to,
      subject,
      text,
    })
    console.log(`[mail] 稿件 #${videoId} 已通知 ${recipients.length} 位收件人（${info.response || info.messageId}）`)
  } catch (err) {
    // SMTP 错误带上错误码与服务器应答，方便从 docker logs 直接定位（如 535 授权码错误、550 收件人不存在）
    const detail = [err.code, err.responseCode, err.command].filter(Boolean).join(' / ')
    console.error(
      `[mail] 稿件 #${videoId} 通知发送失败${detail ? `（${detail}）` : ''}：${err.response || err.message}`
    )
  }
}
