// biliup 自动投稿任务管理：spawn biliup CLI 上传，解析输出中的BV号并回填稿件状态。
// 任务保存在内存中（内部平台够用），服务重启后进行中的任务丢失，稿件保持 approved 可重试。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import config from '../config.js'
import db from '../db.js'
import { addLog } from './helpers.js'

const jobs = new Map()
let runningJob = null // 同一时间只允许一个投稿任务，避免触发B站风控

export function isConfigured() {
  return fs.existsSync(config.biliup.bin) && fs.existsSync(config.biliup.cookieFile)
}

export function serializeJob(job) {
  if (!job) return null
  return {
    id: job.id,
    videoId: job.videoId,
    status: job.status, // running | succeeded | failed
    bvid: job.bvid,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lastLines: job.lines.slice(-8),
  }
}

export function getJob(id) {
  return jobs.get(id) || null
}

function uploadAbsPath(relPath) {
  return path.join(config.uploadDir, relPath.slice('/uploads/'.length))
}

export function startPublishJob(video, operator, { tid, tags }) {
  // 同稿件重复点击时直接返回进行中的任务（页面刷新后可重新绑定）
  if (runningJob?.status === 'running') {
    if (runningJob.videoId === video.id) return { job: runningJob }
    return { error: `已有稿件（#${runningJob.videoId}）正在自动投稿，请稍后再试` }
  }

  const videoAbs = uploadAbsPath(video.video_path)
  if (!fs.existsSync(videoAbs)) return { error: '视频文件不存在，无法投稿' }

  const args = [
    '-u', config.biliup.cookieFile,
    'upload', videoAbs,
    '--title', video.title,
    '--tid', String(tid),
    '--tag', tags.join(','),
    '--copyright', '1',
  ]
  if (video.description) args.push('--desc', video.description)
  if (video.cover_path) {
    const coverAbs = uploadAbsPath(video.cover_path)
    if (fs.existsSync(coverAbs)) args.push('--cover', coverAbs)
  }

  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    videoId: video.id,
    operatorId: operator.id,
    status: 'running',
    bvid: '',
    error: '',
    lines: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  jobs.set(job.id, job)
  runningJob = job

  // 便于本地联调：bin 指向 .mjs/.js 时用 node 执行（正式环境为 biliup.exe）
  const isScript = /\.(mjs|cjs|js)$/i.test(config.biliup.bin)
  const cmd = isScript ? process.execPath : config.biliup.bin
  const cmdArgs = isScript ? [config.biliup.bin, ...args] : args

  function finish(status, error = '') {
    if (job.status !== 'running') return
    job.status = status
    job.error = error
    job.finishedAt = new Date().toISOString()
    if (!job.bvid) {
      const m = job.lines.join('\n').match(/BV[0-9A-Za-z]{10}/)
      if (m) job.bvid = m[0]
    }
    if (status === 'succeeded' && job.bvid) {
      // 稿件可能在上传期间被改动，回填前再确认一次状态
      const fresh = db.prepare('SELECT status FROM videos WHERE id = ?').get(video.id)
      if (fresh?.status === 'approved') {
        db.prepare(
          `UPDATE videos SET status = 'published', bilibili_bvid = ?,
             published_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
           WHERE id = ?`
        ).run(job.bvid, video.id)
        addLog(video.id, operator.id, 'publish', `biliup 自动投稿成功：${job.bvid}`)
      }
    }
    console.log(`[biliup] 任务 ${job.id} ${status}${job.bvid ? ' ' + job.bvid : ''}${error ? ' ' + error : ''}`)
  }

  let child
  try {
    child = spawn(cmd, cmdArgs, { windowsHide: true })
  } catch (err) {
    finish('failed', `无法启动 biliup：${err.message}`)
    return { job }
  }

  const onData = (buf) => {
    const text = buf.toString('utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      job.lines.push(line)
      if (job.lines.length > 200) job.lines.shift()
    }
    if (!job.bvid) {
      const m = text.match(/BV[0-9A-Za-z]{10}/)
      if (m) job.bvid = m[0]
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('error', (err) => finish('failed', `biliup 进程错误：${err.message}`))
  child.on('close', (code) => {
    if (code === 0) finish('succeeded')
    else finish('failed', `biliup 退出码 ${code}，请查看输出排查（cookie 过期可运行 biliup renew）`)
  })

  return { job }
}
