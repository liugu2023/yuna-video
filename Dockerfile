# 多阶段构建：前端产物 + 后端生产依赖（含 biliup / ffmpeg 二进制）→ 单容器运行，后端直接托管前端
# 国内网络构建加速（按需）：
#   docker build -t yuna-video \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     --build-arg BILIUP_GH_MIRROR=https://ghfast.top/ \
#     --build-arg FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static .

# ---- 阶段1：构建前端 ----
FROM node:24-slim AS web-builder
ARG NPM_REGISTRY=
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci
COPY web/ ./
RUN npm run build

# ---- 阶段2：后端生产依赖 + biliup / ffmpeg 二进制 ----
FROM node:24-slim AS server-deps
# biliup 的 tar.xz 解压需要 xz
RUN apt-get update && apt-get install -y --no-install-recommends xz-utils && rm -rf /var/lib/apt/lists/*
ARG NPM_REGISTRY=
ARG BILIUP_VERSION=v0.2.4
ARG BILIUP_GH_MIRROR=
ARG BILIUP_SKIP_DOWNLOAD=
ARG FFMPEG_BINARIES_URL=
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
COPY server/scripts/install-biliup.mjs scripts/
# npm ci 会顺带跑 postinstall 装 biliup（软失败）；下一行硬性兜底，确保真的装上（除非显式跳过）
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci --omit=dev \
  && mkdir -p bin \
  && { [ "$BILIUP_SKIP_DOWNLOAD" = "1" ] || npm run biliup:install; }

# ---- 阶段3：运行镜像 ----
FROM node:24-slim
# tzdata：SQLite 的 datetime('now','localtime') 依赖系统时区数据
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
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
