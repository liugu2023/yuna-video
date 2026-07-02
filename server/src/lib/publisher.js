// biliup 自动投稿任务管理：spawn biliup CLI 上传，解析输出中的BV号并回填稿件状态。
// 任务保存在内存中（内部平台够用），服务重启后进行中的任务丢失，稿件保持 approved 可重试。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import config from '../config.js'
import db from '../db.js'
import { addLog, cleanupPublishedVideo } from './helpers.js'
import { addVideoToSeason } from './bili-season.js'

const jobs = new Map()
let runningJob = null // 同一时间只允许一个投稿任务，避免触发B站风控

export function isConfigured() {
  return fs.existsSync(config.biliup.bin) && fs.existsSync(config.biliup.cookieFile)
}

// ---- biliup 输出清洗：CLI 日志自带 ANSI 颜色码和 tracing 前缀，直接透传到页面是乱码 ----
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g
// 形如「2026-07-02 15:06:01  INFO biliup::uploader::line: 」的前缀
const LOG_PREFIX_RE = /^\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?\s+(INFO|WARN|ERROR|DEBUG|TRACE)\s+[\w:.-]+:\s*/

export function cleanBiliupLine(raw) {
  const stripped = raw.replace(ANSI_RE, '').trim()
  if (!stripped) return ''
  const m = stripped.match(LOG_PREFIX_RE)
  if (!m) return stripped
  let msg = stripped.slice(m[0].length).trim()
  // pre_upload 的原始 JSON 换成人话（文件名 + 大小）
  const pre = msg.match(/^pre_upload:\s*(\{.*\})/)
  if (pre) {
    try {
      const info = JSON.parse(pre[1])
      const size = info.size ? `（${(info.size / 1024 / 1024).toFixed(1)} MB）` : ''
      msg = `开始上传 ${info.name || '视频文件'}${size}`
    } catch {
      /* 解析失败保留原文 */
    }
  }
  return m[1] === 'INFO' ? msg : `[${m[1]}] ${msg}`
}

// 从清洗后的输出推断当前阶段，运行中的页面显示这个而不是原始日志
function stageFromLine(msg, job) {
  if (/number of concurrent futures/.test(msg)) return '正在选择上传线路…'
  if (/^开始上传/.test(msg)) return `${msg}，上传中请耐心等待…`
  if (/^Upload completed/.test(msg)) {
    const t = msg.match(/cost ([\d.]+)s, ([\d.]+) MB\/s/)
    return t ? `视频上传完成（用时 ${t[1]}s，均速 ${t[2]} MB/s），正在提交稿件…` : '视频上传完成，正在提交稿件…'
  }
  if (/投稿成功|稿件提交成功/.test(msg)) return '投稿成功，正在回填稿件状态…'
  return job.stage
}

export function serializeJob(job) {
  if (!job) return null
  return {
    id: job.id,
    videoId: job.videoId,
    status: job.status, // running | succeeded | failed
    stage: job.stage,
    bvid: job.bvid,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lastLines: job.lines.slice(-8),
    seasonTitle: job.season?.title || '',
    seasonStatus: job.seasonStatus, // '' | adding | added | failed
    seasonError: job.seasonError,
  }
}

export function getJob(id) {
  return jobs.get(id) || null
}

function uploadAbsPath(relPath) {
  return path.join(config.uploadDir, relPath.slice('/uploads/'.length))
}

// 投稿成功后把稿件加入合集；失败不影响投稿结果，仅记录日志供人工补救
async function addToSeasonAfterPublish(job, video) {
  job.seasonStatus = 'adding'
  try {
    await addVideoToSeason({ bvid: job.bvid, aid: job.aid, title: video.title, sectionId: job.season.sectionId })
    job.seasonStatus = 'added'
    addLog(video.id, job.operatorId, 'season', `已将稿件加入合集「${job.season.title}」`)
  } catch (err) {
    job.seasonStatus = 'failed'
    job.seasonError = err.message
    addLog(video.id, job.operatorId, 'season', `加入合集「${job.season.title}」失败：${err.message}（可到B站创作中心手动添加）`)
  }
  console.log(`[biliup] 任务 ${job.id} 合集 ${job.seasonStatus}${job.seasonError ? ' ' + job.seasonError : ''}`)
}

export function startPublishJob(video, operator, { tid, tags, season }) {
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
    stage: '正在启动 biliup…',
    bvid: '',
    aid: 0,
    error: '',
    lines: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    season: season || null, // { id, sectionId, title }
    seasonStatus: '',
    seasonError: '',
  }
  jobs.set(job.id, job)
  runningJob = job

  // 便于本地联调：bin 指向 .mjs/.js 时用 node 执行（正式环境为 biliup.exe）
  const isScript = /\.(mjs|cjs|js)$/i.test(config.biliup.bin)
  const cmd = isScript ? process.execPath : config.biliup.bin
  const cmdArgs = isScript ? [config.biliup.bin, ...args] : args

  function extractIds(text) {
    if (!job.bvid) {
      const m = text.match(/BV[0-9A-Za-z]{10}/)
      if (m) job.bvid = m[0]
    }
    if (!job.aid) {
      // 兼容 JSON（"aid":123）与 Rust Debug（"aid": Number(123)）两种输出
      const m = text.match(/"aid"\s*:\s*(?:Number\()?(\d+)/)
      if (m) job.aid = Number(m[1])
    }
  }

  function finish(status, error = '') {
    if (job.status !== 'running') return
    job.status = status
    job.error = error
    job.finishedAt = new Date().toISOString()
    extractIds(job.lines.join('\n'))
    if (status === 'succeeded' && job.bvid) {
      job.stage = '投稿成功'
      // 稿件可能在上传期间被改动，回填前再确认一次状态
      const fresh = db.prepare('SELECT status FROM videos WHERE id = ?').get(video.id)
      if (fresh?.status === 'approved') {
        db.prepare(
          `UPDATE videos SET status = 'published', bilibili_bvid = ?,
             published_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
           WHERE id = ?`
        ).run(job.bvid, video.id)
        const cleaned = cleanupPublishedVideo(video.id)
        addLog(video.id, operator.id, 'publish', `biliup 自动投稿成功：${job.bvid}${cleaned ? '；本地视频文件已清理' : ''}`)
        if (job.season) addToSeasonAfterPublish(job, video)
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
      const line = cleanBiliupLine(raw)
      if (!line) continue
      job.lines.push(line)
      if (job.lines.length > 200) job.lines.shift()
      job.stage = stageFromLine(line, job)
    }
    extractIds(text)
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
