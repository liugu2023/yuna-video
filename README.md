# 协会B站投稿审核平台

协会内部自用的B站视频上传审核平台，前后端分离架构。部长上传视频 → 部门主席审核 → 通过后发布到协会B站账号并回填BV号归档。

## 技术栈

| 端 | 技术 |
| --- | --- |
| 后端 `server/` | Node.js + Express + `node:sqlite`（内置SQLite，零原生依赖）+ JWT + Multer |
| 前端 `web/` | Vue 3 + Vite + Vue Router + Pinia + Element Plus（B站粉主题） |

## 快速开始

要求：Node.js 23.4+（推荐 24 LTS，数据库使用 Node 内置的 `node:sqlite`，无需安装任何数据库）。

```bash
# 终端1：后端（默认 http://localhost:3000）
cd server
npm install
npm run dev

# 终端2：前端（默认 http://localhost:5173，已代理 /api 与 /uploads 到后端）
cd web
npm install
npm run dev
```

Windows 下也可以直接双击根目录的 `start-dev.bat` 一键启动两端（需先各自 `npm install`）。

首次启动后端会自动建库，并创建默认管理员：**admin / admin123456**（请登录后尽快修改密码）。平台不开放自助注册，成员账号由管理员在「成员管理」中统一创建。

## 角色与流程

- **部长（member）**：各部门的成员，上传视频、编辑草稿、提交审核、撤回、查看驳回原因后重新提交。
- **主席（reviewer）**：审核**本部门**部长的稿件（未分配部门的主席可审全站，兼容老账号），在线预览视频，通过 / 驳回（必填原因），审核通过后投稿B站并回填BV号；可用协会账号发布B站动态。
- **管理员（admin）**：不受部门限制的全部权限 + 成员管理（建号、分配部门与邮箱、改角色、禁用、重置密码）。

部门在成员管理中分配（下拉可直接输入新部门名）。部长提交审核时，若配置了邮件服务，会**立即邮件通知对应部门的主席**（主席需在成员管理里填了邮箱；无匹配主席时兜底通知管理员）。

稿件状态机：

```
草稿 draft ──提交──> 待审核 pending ──通过──> 已通过 approved ──填BV号──> 已发布 published
   ↑                    │
   └────撤回────────────┘
   ↑
   └──重新编辑── 已驳回 rejected <──驳回（必填原因）── pending
```

所有提交 / 撤回 / 通过 / 驳回 / 发布操作都会写入操作日志，稿件详情页可见完整时间线。

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 后端端口 |
| `JWT_SECRET` | 开发用默认值 | 生产环境务必修改 |
| `BILI_KEEPALIVE_HOURS` | `12` | B站登录态自动检查间隔（小时） |
| `BILI_RENEW_DAYS` | `7` | 距上次续期超过该天数时自动续期 |
| `BILIUP_VERSION` | `v0.2.4` | 自动下载的 biliup-rs 版本，设为 `latest` 取最新版 |
| `BILIUP_GH_MIRROR` | 空（直连） | GitHub 下载镜像前缀（国内服务器加速），如 `https://ghfast.top/` |
| `BILIUP_SKIP_DOWNLOAD` | 空 | 设为 `1` 时 `npm install` 不下载 biliup（离线环境手动放置） |
| `SMTP_USER` / `SMTP_PASS` | 空（不发邮件） | 发件邮箱账号与授权码（QQ邮箱：设置→账户→开启SMTP获取授权码），两者都配置后启用提交审核邮件通知 |
| `SMTP_HOST` / `SMTP_PORT` | `smtp.qq.com` / `465` | 其他邮箱服务商时修改 |
| `SMTP_FROM` | 同 `SMTP_USER` | 发件人地址 |
| `SITE_URL` | 空 | 平台对外访问地址（如 `https://video.example.com`），配置后通知邮件带审核直达链接 |

上传限制：视频单文件 8GB（对齐B站），封面 10MB（jpg/png/webp，建议 1146×717）。标题 ≤80 字、简介 ≤2000 字、标签 ≤10 个，与B站投稿规则一致。

## 发布到B站：两种方式

**方式一：人工回填（默认）**。审核通过后由运营手动投稿到协会B站账号，再在平台回填BV号归档。

**方式二：biliup 自动投稿（可选集成）**。配置后审核详情页会出现"自动投稿"面板，一键以协会账号投稿并自动回填BV号：

1. biliup 可执行文件在 `npm install` 时按平台自动下载到 `server/bin/`（支持 Linux / Windows / macOS，x64 与 arm64，自动校验官方 sha256）。当时失败或跳过的话，在 `server` 目录运行 `npm run biliup:install` 补装（强制更新加 `-- --force`）；国内服务器访问 GitHub 慢可设置镜像前缀，如 `BILIUP_GH_MIRROR=https://ghfast.top/`；
2. 管理员登录平台，进入左侧「B站账号」页面，点击「扫码绑定」，用手机B站App扫码确认——立即生效，无需重启。

离线服务器：设 `BILIUP_SKIP_DOWNLOAD=1` 跳过下载，手动把对应平台的 biliup 二进制放到 `server/bin/biliup`（Windows 为 `biliup.exe`）。也可用 CLI 绑定（与页面扫码效果等同、cookie 格式互换）：在 `server` 目录运行 `bin/biliup -u data/cookies.json login`。环境变量 `BILIUP_BIN`、`BILIUP_COOKIE` 可指定其他路径。同一时间只允许一个自动投稿任务；任务保存在内存中，服务重启后进行中的任务需重新发起（稿件仍是"已通过"状态，不会丢）。

### 登录态自动保活

后端每 `BILI_KEEPALIVE_HOURS`（默认12）小时自动校验一次B站登录态（官方 nav 接口）；cookie 失效或距上次续期超过 `BILI_RENEW_DAYS`（默认7）天时，自动用 refresh_token 静默续期（`biliup renew`，无需密码和验证码）。「B站账号」页面可查看最近检查/续期结果，并支持手动「立即检查」「手动续期」「解绑」。若续期后校验仍失败（refresh_token 也失效，如账号在别处改密），需重新扫码绑定。

平台不保存B站账号密码（B站账密登录强制极验验证码，无法无人值守）；登录凭据只存在服务器本机 `server/data/cookies.json`，绑定/保活/解绑接口仅管理员可用。

### 发布B站动态

绑定账号后，主席和管理员可在「B站动态」页面以协会账号发布动态（公告、活动宣传等）：正文最多 1000 字，配图最多 9 张（jpg/png/gif，单张 ≤20MB，先传B站图床再发布）。发布记录（发布人、内容、动态链接）保存在平台内可追溯。走B站网页端接口，与投稿一样属于非官方渠道，请控制发布频率。

> ⚠️ 说明：B站官方开放平台（open.bilibili.com）的投稿API仅面向**企业认证**开发者（需营业执照与盖章公函），社团一般无法申请。biliup 走的是B站网页端接口（社区逆向，录播圈广泛使用），非官方渠道，存在接口变动或触发风控的可能——请使用协会自己的账号、控制投稿频率。链路验证可用 mock：
> ```bash
> cd server
> BILIUP_BIN="$PWD/scripts/mock-biliup.mjs" BILIUP_COOKIE="$PWD/scripts/mock-cookies.json" node src/app.js
> node scripts/smoke-autopublish.mjs   # 另开终端
> ```

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录（返回 JWT，账号由管理员创建） |
| GET/PUT | `/api/auth/me` `/api/auth/password` | 当前用户 / 改密 |
| POST | `/api/upload/video` `/api/upload/cover` | 上传视频 / 封面（multipart, 字段 `file`） |
| GET/POST | `/api/videos` | 我的稿件列表 / 新建草稿 |
| GET/PUT/DELETE | `/api/videos/:id` | 详情（含日志）/ 编辑 / 删除 |
| POST | `/api/videos/:id/submit` `/api/videos/:id/withdraw` | 提交审核 / 撤回 |
| GET | `/api/review/videos` | 稿件列表（主席按部门隔离，管理员全站） |
| POST | `/api/review/videos/:id/approve` `/reject` `/publish` | 通过 / 驳回 / 人工回填BV号 |
| GET/POST/GET | `/api/review/publish-config` `/videos/:id/auto-publish` `/publish-jobs/:jobId` | 自动投稿：配置状态 / 发起 / 查询任务 |
| GET/POST | `/api/bili/status` `/qrcode` `/qrcode/poll` | B站绑定状态 / 生成登录二维码 / 轮询扫码结果（管理员） |
| POST/DELETE | `/api/bili/check` `/renew` `/binding` | 立即检查登录态 / 手动续期 / 解绑（管理员） |
| GET/GET/POST | `/api/bili/dynamic/state` `/dynamic/history` `/dynamic` | 动态发布：绑定状态 / 历史 / 发布（审核员+管理员，multipart：`text` + `images[]`） |
| GET/POST/PUT | `/api/admin/users` | 成员管理（管理员） |
| GET | `/api/stats/dashboard` | 工作台统计 |

## 生产部署

```bash
cd web && npm run build   # 产物在 web/dist
cd ../server && npm start # 后端检测到 web/dist 后会直接托管前端，单端口 3000 即可访问
```

数据文件在 `server/data/`，上传文件在 `server/uploads/`，备份这两个目录即可。服务器上执行 `npm install` 时会自动下载当前平台（如 Linux x64/arm64）对应的 biliup 二进制到 `server/bin/`，无需手动准备；解压 `tar.xz` 依赖系统的 `tar` 与 `xz`（Debian/Ubuntu：`apt install xz-utils`）。

## 说明

- 视频在线预览走浏览器原生播放器；浏览器不支持的编码（老式MPEG-4、HEVC、mkv/avi 内的各类编码等）会**自动转码生成 H.264 预览副本**（720p，ffmpeg，随 `npm install` 自动安装），转码期间审核页显示进度提示并自动刷新。原始文件原样保留用于投稿B站。国内服务器安装 ffmpeg 慢可设 `FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static` 后再 `npm install`；也可用 `FFMPEG_PATH` 指定系统已装的 ffmpeg。
- 稿件发布成功后（人工回填BV号或自动投稿），本地视频文件会自动删除以节约磁盘空间（封面与稿件记录保留，详情页提供B站观看链接）；启动时会兜底清扫历史遗留文件。
- 接口冒烟测试：`node scripts/smoke-test.mjs`（主流程）、`node scripts/smoke-autopublish.mjs`（自动投稿链路）、`node scripts/smoke-bili.mjs`（B站绑定与保活链路，需联网）、`node scripts/smoke-dynamic.mjs`（动态发布链路，需联网、不会真实发出动态），除主流程外均需 mock 配置启动后端（见各脚本头部注释）。
