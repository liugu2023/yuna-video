# 多阶段构建：前端产物 + 后端生产依赖（含 biliup 二进制）→ alpine 运行镜像
# ffmpeg 用 apk 版并通过 FFMPEG_PATH 指定（跳过 ffmpeg-static 的大体积静态二进制下载）。
# 国内网络构建加速（按需）：
#   docker build -t yuna-video \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     --build-arg BILIUP_GH_MIRROR=https://ghfast.top/ \
#     --build-arg APK_MIRROR=https://mirrors.tuna.tsinghua.edu.cn .
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

# ---- 阶段2：后端生产依赖 + biliup 二进制 ----
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
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
COPY server/scripts/install-biliup.mjs scripts/
# --ignore-scripts 跳过 ffmpeg-static 的二进制下载（运行镜像用 apk 版 ffmpeg），装完删掉该包壳；
# biliup 单独显式安装（安装脚本会识别 alpine 自动选 musl 版并试运行校验），失败即构建失败
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci --omit=dev --ignore-scripts \
  && rm -rf node_modules/ffmpeg-static \
  && mkdir -p bin \
  && { [ "$BILIUP_SKIP_DOWNLOAD" = "1" ] || npm run biliup:install; }

# ---- 阶段3：运行镜像 ----
FROM node:24-alpine
ARG APK_MIRROR=
# ffmpeg：预览转码用；tzdata：SQLite datetime('now','localtime') 依赖系统时区数据
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s|https://dl-cdn.alpinelinux.org|$APK_MIRROR|g" /etc/apk/repositories; fi \
  && apk add --no-cache ffmpeg tzdata
ENV NODE_ENV=production TZ=Asia/Shanghai FFMPEG_PATH=/usr/bin/ffmpeg
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
