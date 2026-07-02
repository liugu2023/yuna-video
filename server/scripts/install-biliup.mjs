// 下载当前平台对应的 biliup-rs 可执行文件到 server/bin/（自动投稿与 cookie 续期依赖它）。
// 随 npm install 自动执行（postinstall --soft 模式：失败只警告，不阻断安装）；
// 也可手动执行：npm run biliup:install（失败退出码非0），强制更新：npm run biliup:install -- --force
//
// 环境变量：
//   BILIUP_VERSION       biliup-rs 版本（默认 v0.2.4；设为 latest 则查询 GitHub API 取最新版）
//   BILIUP_GH_MIRROR     GitHub 加速镜像前缀，国内服务器建议设置（示例 https://ghfast.top/）
//   BILIUP_ASSET         手动指定资产文件名（覆盖平台自动检测，如 musl 环境）
//   BILIUP_SKIP_DOWNLOAD 设为 1 跳过下载（离线环境：手动把二进制放到 server/bin/ 即可）
//   BILIUP_BIN           自定义二进制路径（与后端运行时一致）
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DEFAULT_VERSION = 'v0.2.4'
const REPO = 'biliup/biliup-rs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const binPath = process.env.BILIUP_BIN || path.join(rootDir, 'bin', isWin ? 'biliup.exe' : 'biliup')
const force = process.argv.includes('--force')
const soft = process.argv.includes('--soft')
const mirror = process.env.BILIUP_GH_MIRROR || ''

function log(msg) {
  console.log(`[biliup-install] ${msg}`)
}

// 注意：不要用 process.exit()——Windows 上 fetch 失败后立即强退会触发 libuv 断言崩溃（退出码 127），
// 抛错后由末尾统一设置 process.exitCode、让事件循环自然结束。
class InstallError extends Error {}

function fail(msg) {
  throw new InstallError(msg)
}

// 平台 → release 资产名（biliupR-v0.2.4-x86_64-linux.tar.xz / ...-x86_64-windows.zip）
function assetName(version) {
  if (process.env.BILIUP_ASSET) return process.env.BILIUP_ASSET
  const archMap = { x64: 'x86_64', arm64: 'aarch64', arm: 'arm' }
  const arch = archMap[process.arch]
  if (!arch) fail(`不支持的 CPU 架构：${process.arch}，请设置 BILIUP_ASSET 或手动放置二进制`)
  if (process.platform === 'win32') {
    if (arch !== 'x86_64') fail(`Windows 仅提供 x86_64 版本（当前 ${process.arch}）`)
    return `biliupR-${version}-x86_64-windows.zip`
  }
  if (process.platform === 'darwin') return `biliupR-${version}-${arch}-macos.tar.xz`
  if (process.platform === 'linux') {
    const musl = arch === 'x86_64' && fs.existsSync('/etc/alpine-release') ? '-musl' : ''
    return `biliupR-${version}-${arch}-linux${musl}.tar.xz`
  }
  fail(`不支持的平台：${process.platform}，请设置 BILIUP_ASSET 或手动放置二进制`)
}

async function fetchOk(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res
}

// 查询 release 元数据（版本号解析 + sha256 校验值）；查不到不阻断，仅跳过校验
async function fetchReleaseMeta(version) {
  const api =
    version === 'latest'
      ? `https://api.github.com/repos/${REPO}/releases/latest`
      : `https://api.github.com/repos/${REPO}/releases/tags/${version}`
  const res = await fetchOk(api, 15000)
  return res.json()
}

function extract(archive, destDir) {
  if (archive.endsWith('.zip')) {
    const r = isWin
      ? spawnSync('powershell.exe', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
          `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${destDir}" -Force`,
        ], { stdio: 'pipe' })
      : spawnSync('unzip', ['-o', archive, '-d', destDir], { stdio: 'pipe' })
    if (r.status !== 0) fail(`解压 zip 失败：${r.stderr?.toString() || r.error?.message || `退出码 ${r.status}`}`)
    return
  }
  const r = spawnSync('tar', ['-xJf', archive, '-C', destDir], { stdio: 'pipe' })
  if (r.status !== 0) {
    fail(
      `解压 tar.xz 失败（${r.stderr?.toString().trim() || r.error?.message || `退出码 ${r.status}`}）。` +
        '请确认系统已安装 tar 与 xz（Debian/Ubuntu: apt install xz-utils；Alpine: apk add tar xz）'
    )
  }
}

// 在解压目录里递归找 biliup 可执行文件
function findBinary(dir) {
  const want = isWin ? 'biliup.exe' : 'biliup'
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, ent.name)
      if (ent.isDirectory()) stack.push(p)
      else if (ent.name === want) return p
    }
  }
  return null
}

// ---- 主流程 ----
async function main() {
  if (process.env.BILIUP_SKIP_DOWNLOAD === '1') {
    log('BILIUP_SKIP_DOWNLOAD=1，跳过下载')
    return
  }
  if (fs.existsSync(binPath) && !force) {
    log(`已存在 ${binPath}，跳过（更新请加 --force）`)
    return
  }

  let version = process.env.BILIUP_VERSION || DEFAULT_VERSION
  let expectedSha = ''
  try {
    const meta = await fetchReleaseMeta(version)
    version = meta.tag_name || version
    const digest = meta.assets?.find((a) => a.name === assetName(version))?.digest || ''
    if (digest.startsWith('sha256:')) expectedSha = digest.slice(7)
  } catch (err) {
    if (err instanceof InstallError) throw err
    if (version === 'latest') fail(`无法查询最新版本（${err.message}）；国内服务器建议固定 BILIUP_VERSION 并设置 BILIUP_GH_MIRROR`)
    log(`GitHub API 不可达（${err.message}），使用固定版本 ${version} 直接下载，跳过 sha256 校验`)
  }

  const asset = assetName(version)
  const url = `${mirror}https://github.com/${REPO}/releases/download/${version}/${asset}`
  log(`下载 ${url}`)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biliup-'))
  try {
    let buf
    try {
      const res = await fetchOk(url, 180000)
      buf = Buffer.from(await res.arrayBuffer())
    } catch (err) {
      fail(`下载失败：${err.message}${mirror ? '' : '（国内服务器可设置 BILIUP_GH_MIRROR=https://ghfast.top/ 等镜像加速）'}`)
    }
    log(`已下载 ${(buf.length / 1024 / 1024).toFixed(1)} MB`)

    if (expectedSha) {
      const actual = crypto.createHash('sha256').update(buf).digest('hex')
      if (actual !== expectedSha) fail(`sha256 校验不通过（期望 ${expectedSha}，实际 ${actual}），下载源可能被篡改`)
      log('sha256 校验通过')
    }

    const archive = path.join(tmpDir, asset)
    fs.writeFileSync(archive, buf)
    extract(archive, tmpDir)

    const found = findBinary(tmpDir)
    if (!found) fail('压缩包内未找到 biliup 可执行文件')
    fs.mkdirSync(path.dirname(binPath), { recursive: true })
    fs.copyFileSync(found, binPath)
    if (!isWin) fs.chmodSync(binPath, 0o755)

    // 试运行确认二进制与当前系统匹配
    const ver = spawnSync(binPath, ['--version'], { stdio: 'pipe', windowsHide: true })
    if (ver.status === 0) {
      log(`安装完成：${binPath}（${ver.stdout.toString().trim()}）`)
    } else {
      fail(`二进制无法运行（${ver.error?.message || `退出码 ${ver.status}`}），可能与系统架构不匹配，请设置 BILIUP_ASSET 后重试`)
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

try {
  await main()
} catch (err) {
  const msg = err instanceof InstallError ? err.message : `未预期的错误：${err.stack || err}`
  if (soft) {
    console.warn(`[biliup-install] 跳过：${msg}`)
    console.warn('[biliup-install] 不影响平台其他功能；之后可运行 npm run biliup:install 重试（国内服务器可设置 BILIUP_GH_MIRROR 加速）')
  } else {
    console.error(`[biliup-install] 失败：${msg}`)
    process.exitCode = 1
  }
}
