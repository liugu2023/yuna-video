// 视频预览转码：浏览器解不了的编码（老式MPEG-4、HEVC、mkv/avi里的各类编码等）
// 自动转一份 H.264/AAC 的 mp4 预览副本（最长边≤1280，faststart），供审核页在线播放。
// 原始文件原样保留用于投稿B站。同一时间只跑一个转码任务，避免占满CPU。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import config from '../config.js'
import db from '../db.js'

let ffmpegPath = process.env.FFMPEG_PATH || ''
if (!ffmpegPath) {
  try {
    ffmpegPath = (await import('ffmpeg-static')).default || ''
  } catch {}
}

export function isTranscoderAvailable() {
  return Boolean(ffmpegPath && fs.existsSync(ffmpegPath))
}

// 浏览器 <video> 原生可解的编码；容器还得是 mp4/webm/mov 系
const SAFE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
const SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis'])
const SAFE_CONTAINER = /\.(mp4|m4v|webm|mov)$/i

function absUpload(relPath) {
  return path.join(config.uploadDir, relPath.slice('/uploads/'.length))
}

function setPreview(videoId, status, previewPath = '') {
  db.prepare('UPDATE videos SET preview_status = ?, preview_path = ? WHERE id = ?').run(status, previewPath, videoId)
}

// 用 ffmpeg -i 的流信息探测视频/音频编码（ffmpeg 无输出时退出码非0，属正常）
function probeCodecs(absPath) {
  return new Promise((resolve) => {
    let out = ''
    let child
    try {
      child = spawn(ffmpegPath, ['-hide_banner', '-i', absPath], { windowsHide: true })
    } catch {
      resolve(null)
      return
    }
    child.stderr.on('data', (b) => {
      out += b.toString('utf8')
      if (out.length > 65536) child.kill()
    })
    child.on('error', () => resolve(null))
    child.on('close', () => {
      const video = out.match(/Stream #\d+:\d+.*?: Video: (\w+)/)?.[1]?.toLowerCase() || ''
      const audio = out.match(/Stream #\d+:\d+.*?: Audio: (\w+)/)?.[1]?.toLowerCase() || ''
      resolve({ video, audio })
    })
  })
}

const queue = []
let running = false

// 建稿/换视频后调用：探测编码，浏览器不支持时排队转码
export async function ensurePreview(videoId) {
  try {
    const video = db.prepare('SELECT id, video_path FROM videos WHERE id = ?').get(videoId)
    if (!video?.video_path) return
    if (!isTranscoderAvailable()) {
      setPreview(videoId, 'skipped')
      return
    }
    const abs = absUpload(video.video_path)
    if (!fs.existsSync(abs)) return

    const codecs = await probeCodecs(abs)
    const browserOk =
      codecs &&
      codecs.video &&
      SAFE_VIDEO.has(codecs.video) &&
      (!codecs.audio || SAFE_AUDIO.has(codecs.audio)) &&
      SAFE_CONTAINER.test(video.video_path)
    if (browserOk) {
      setPreview(videoId, 'none')
      return
    }
    setPreview(videoId, 'processing')
    if (!queue.includes(videoId)) queue.push(videoId)
    runNext()
  } catch (err) {
    console.warn(`[transcode] 稿件 #${videoId} 预览探测失败：${err.message}`)
  }
}

function runNext() {
  if (running) return
  const id = queue.shift()
  if (id == null) return
  running = true

  const video = db.prepare('SELECT id, video_path FROM videos WHERE id = ?').get(id)
  if (!video?.video_path) {
    // 转码等待期间稿件被删或换了文件
    running = false
    runNext()
    return
  }
  const input = absUpload(video.video_path)
  const base = path.basename(video.video_path).replace(/\.[^.]+$/, '')
  const outRel = `/uploads/previews/${base}_preview.mp4`
  const out = absUpload(outRel)
  fs.mkdirSync(path.dirname(out), { recursive: true })

  const args = [
    '-y', '-i', input,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-vf', "scale='min(1280,iw)':-2",
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    out,
  ]
  console.log(`[transcode] 稿件 #${id} 开始生成预览…`)
  const child = spawn(ffmpegPath, args, { windowsHide: true })
  let errTail = ''
  child.stderr.on('data', (b) => {
    errTail = (errTail + b.toString('utf8')).slice(-4000)
  })
  const finish = (ok, note = '') => {
    running = false
    if (ok) {
      setPreview(id, 'ready', outRel)
      console.log(`[transcode] 稿件 #${id} 预览已生成：${outRel}`)
    } else {
      fs.rmSync(out, { force: true })
      setPreview(id, 'failed')
      console.warn(`[transcode] 稿件 #${id} 预览转码失败${note}\n${errTail.split('\n').slice(-4).join('\n')}`)
    }
    runNext()
  }
  child.on('error', (err) => finish(false, `：${err.message}`))
  child.on('close', (code) => finish(code === 0 && fs.existsSync(out), `（退出码 ${code}）`))
}

// 启动时：恢复被重启打断的任务，并补扫未探测过的历史稿件
export function recoverPreviews() {
  if (!isTranscoderAvailable()) {
    console.log('[transcode] 未找到 ffmpeg，预览转码不可用（浏览器不支持的编码将提示下载查看）')
    return
  }
  const rows = db
    .prepare(`SELECT id FROM videos WHERE video_path != '' AND preview_status IN ('', 'processing', 'skipped')`)
    .all()
  if (rows.length) console.log(`[transcode] 启动检查：${rows.length} 个稿件待探测/续转预览`)
  for (const { id } of rows) ensurePreview(id)
}
