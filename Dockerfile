# 多阶段构建：前端产物 + 后端生产依赖（含 biliup、ffmpeg 二进制）→ 裸 alpine 运行镜像
# 体积策略：ffmpeg 用 ffmpeg-static 的全静态二进制（78MB，apk 版会拖 ~125MB 共享库依赖）；
# 运行镜像用裸 alpine 只复制 node 二进制，不带 npm/corepack/yarn/头文件（比直接以 node:24-alpine 为底省 ~30MB）。
# 国内网络构建加速（按需）：
#   docker build -t yuna-video \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     --build-arg BILIUP_GH_MIRROR=https://ghfast.top/ \
#     --build-arg APK_MIRROR=https://mirrors.tuna.tsinghua.edu.cn \
#     --build-arg FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static .
# 注：arm64 无 musl 版 biliup，如需 arm64 镜像请加 --build-arg BILIUP_SKIP_DOWNLOAD=1 后手动放置二进制

# ---- 阶段1：构建前端 ----
FROM node:24-alpine AS web-builder
ARG NPM_REGISTRY=
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci
COPY web/ ./
RUN npm run build

# ---- 阶段2：后端生产依赖 + biliup / ffmpeg 二进制 ----
FROM node:24-alpine AS server-deps
ARG APK_MIRROR=
# biliup 的 tar.xz 解压需要 GNU tar 与 xz
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s|https://dl-cdn.alpinelinux.org|$APK_MIRROR|g" /etc/apk/repositories; fi \
  && apk add --no-cache tar xz
ARG NPM_REGISTRY=
ARG BILIUP_VERSION=v0.2.4
ARG BILIUP_GH_MIRROR=
ARG BILIUP_SKIP_DOWNLOAD=
ARG BILIUP_ASSET=
ARG FFMPEG_BINARIES_URL=
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
COPY server/scripts/install-biliup.mjs scripts/
# --ignore-scripts 先跳过所有安装脚本，再单独触发需要的两个（失败即构建失败）：
#   ffmpeg-static：npm rebuild 触发下载全静态 ffmpeg 二进制，并试运行校验 musl 兼容；
#   biliup：安装脚本会识别 alpine 自动选 musl 版并试运行校验
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci --omit=dev --ignore-scripts \
  && npm rebuild ffmpeg-static \
  && FF="$(node -p "require('ffmpeg-static')")" && "$FF" -version >/dev/null && echo "ffmpeg-static OK: $FF" \
  && mkdir -p bin \
  && { [ "$BILIUP_SKIP_DOWNLOAD" = "1" ] || npm run biliup:install; }

# ---- 阶段3：运行镜像 ----
# 裸 alpine 只带 node 二进制；ffmpeg 走 node_modules 里的 ffmpeg-static（transcoder 默认回退），无需 FFMPEG_PATH
FROM alpine:3.24
ARG APK_MIRROR=
# libstdc++：node 运行依赖；tzdata：SQLite datetime('now','localtime') 依赖系统时区数据
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s|https://dl-cdn.alpinelinux.org|$APK_MIRROR|g" /etc/apk/repositories; fi \
  && apk add --no-cache libstdc++ tzdata
COPY --from=server-deps /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production TZ=Asia/Shanghai
WORKDIR /app/server
COPY --from=server-deps /app/server/node_modules node_modules
COPY --from=server-deps /app/server/bin bin
COPY server/package.json ./
COPY server/src src
COPY server/scripts scripts
COPY --from=web-builder /app/web/dist /app/web/dist
# 数据库/B站凭据在 data，视频封面在 uploads——挂卷持久化，重建容器不丢
VOLUME ["/app/server/data", "/app/server/uploads"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/app.js"]
