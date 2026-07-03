// 运行日志：给 console 输出加时间戳，方便 docker logs / 终端直读。
// 日志只走标准输出、不落盘；磁盘占用由 Docker 日志轮转控制（见 docker-compose.yml 的 logging 配置）。
function two(n) {
  return String(n).padStart(2, '0')
}

function stamp() {
  const d = new Date()
  return `[${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}]`
}

for (const [method, tag] of [
  ['log', ''],
  ['warn', ' [warn]'],
  ['error', ' [error]'],
]) {
  const original = console[method].bind(console)
  console[method] = (...args) => original(stamp() + tag, ...args)
}
