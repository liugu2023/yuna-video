// 模拟 biliup CLI：仅用于本地验证自动投稿链路，不会访问B站。
// 用法：启动后端时设置
//   BILIUP_BIN=<本文件绝对路径> BILIUP_COOKIE=<scripts/mock-cookies.json 绝对路径>
const args = process.argv.slice(2)
console.log('[mock-biliup] 收到参数:', JSON.stringify(args))

if (process.env.MOCK_BILIUP_FAIL) {
  console.error('[mock-biliup] 模拟失败：cookie 已过期')
  process.exit(1)
}

await new Promise((r) => setTimeout(r, 1500))
console.log('Upload completed. 稿件提交成功：{"aid":114514,"bvid":"BV1mk4y1z7XX"}')
