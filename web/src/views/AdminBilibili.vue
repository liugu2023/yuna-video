<template>
  <div v-loading="loading" class="bili-page">
    <!-- 账号绑定 -->
    <div class="page-card">
      <div class="card-title">
        <span>账号绑定</span>
        <el-tag v-if="status?.bound" :type="keepalive?.lastCheckOk ? 'success' : 'danger'" effect="light">
          {{ keepalive?.lastCheckOk ? '登录有效' : '已绑定，登录态异常' }}
        </el-tag>
        <el-tag v-else type="info" effect="light">未绑定</el-tag>
      </div>

      <el-descriptions v-if="status" :column="2" border class="desc">
        <el-descriptions-item label="B站账号">
          <template v-if="keepalive?.uname">
            {{ keepalive.uname }}
            <span class="text-muted">（UID {{ keepalive.mid }}）</span>
          </template>
          <span v-else class="text-muted">—</span>
        </el-descriptions-item>
        <el-descriptions-item label="cookie 更新时间">{{ fmt(status.cookieUpdatedAt) }}</el-descriptions-item>
        <el-descriptions-item label="自动投稿">
          <el-tag :type="status.autoPublishEnabled ? 'success' : 'info'" size="small" effect="light">
            {{ status.autoPublishEnabled ? '已启用' : '未启用' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="biliup 可执行文件">
          <el-tag :type="status.biliupBinExists ? 'success' : 'warning'" size="small" effect="light">
            {{ status.biliupBinExists ? '已就绪' : '未找到' }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="status && !status.biliupBinExists"
        type="warning"
        :closable="false"
        show-icon
        class="tip"
        title="未找到 biliup 可执行文件：扫码绑定与登录态检查可用，但自动续期和自动投稿不可用。请在服务器的 server 目录运行 npm run biliup:install（npm install 时会自动执行；国内服务器可设 BILIUP_GH_MIRROR 镜像加速）。"
      />

      <div class="actions">
        <el-button type="primary" @click="openBind">
          <el-icon><FullScreen /></el-icon>&nbsp;{{ status?.bound ? '重新扫码绑定' : '扫码绑定' }}
        </el-button>
        <el-button v-if="status?.bound" type="danger" plain :loading="acting" @click="unbind">解绑</el-button>
      </div>
      <div class="text-muted tip">
        绑定即用手机B站App扫码登录协会账号，登录凭据只保存在服务器本机（server/data/cookies.json），与 biliup 完全兼容。
        平台不保存账号密码。
      </div>
    </div>

    <!-- 登录态保活 -->
    <div class="page-card">
      <div class="card-title"><span>登录态保活</span></div>

      <el-descriptions v-if="status" :column="2" border class="desc">
        <el-descriptions-item label="最近检查">
          {{ fmt(keepalive?.lastCheckAt) }}
          <el-tag
            v-if="keepalive?.lastCheckAt"
            :type="keepalive.lastCheckOk ? 'success' : 'danger'"
            size="small"
            effect="light"
            style="margin-left: 6px"
          >
            {{ keepalive.lastCheckOk ? '正常' : '异常' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="检查结果">{{ keepalive?.lastCheckMsg || '—' }}</el-descriptions-item>
        <el-descriptions-item label="最近续期">
          {{ fmt(keepalive?.lastRenewAt) }}
          <el-tag
            v-if="keepalive?.lastRenewAt"
            :type="keepalive.lastRenewOk ? 'success' : 'danger'"
            size="small"
            effect="light"
            style="margin-left: 6px"
          >
            {{ keepalive.lastRenewOk ? '成功' : '失败' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="保活策略">
          每 {{ status.intervalHours }} 小时自动检查；失效或距上次续期超过 {{ status.renewDays }} 天时自动续期
        </el-descriptions-item>
      </el-descriptions>

      <div class="actions">
        <el-button :loading="checking" :disabled="!status?.bound" @click="checkNow">
          <el-icon><Refresh /></el-icon>&nbsp;立即检查
        </el-button>
        <el-button
          :loading="renewing"
          :disabled="!status?.bound || !status?.biliupBinExists"
          @click="renewNow"
        >
          <el-icon><Timer /></el-icon>&nbsp;手动续期
        </el-button>
      </div>
      <div class="text-muted tip">
        续期使用 refresh_token 静默刷新（biliup renew），无需密码和验证码。若续期后登录校验仍失败，说明凭据已彻底失效，需要重新扫码绑定。
      </div>
    </div>

    <!-- 扫码绑定弹窗 -->
    <el-dialog
      v-model="bindDialog"
      title="扫码绑定B站账号"
      width="360px"
      align-center
      @closed="stopPolling"
    >
      <div class="qr-box">
        <div class="qr-wrap">
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="登录二维码" class="qr-img" />
          <div v-else class="qr-placeholder" v-loading="true" />
          <div v-if="qrStatus === 'expired'" class="qr-mask" @click="startQrcode">
            <el-icon :size="28"><RefreshRight /></el-icon>
            <span>二维码已过期<br />点击刷新</span>
          </div>
          <div v-else-if="qrStatus === 'scanned'" class="qr-mask qr-mask-ok">
            <el-icon :size="28"><CircleCheck /></el-icon>
            <span>已扫码<br />请在手机上确认登录</span>
          </div>
        </div>
        <div class="qr-hint">
          <template v-if="qrStatus === 'error'">
            <el-text type="danger">{{ qrError }}</el-text>
            <el-button size="small" style="margin-left: 8px" @click="startQrcode">重试</el-button>
          </template>
          <template v-else>请使用手机B站App扫码，并用<b>协会账号</b>确认登录</template>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import QRCode from 'qrcode'
import { biliApi } from '../api'

const loading = ref(false)
const acting = ref(false)
const checking = ref(false)
const renewing = ref(false)
const status = ref(null)
const keepalive = computed(() => status.value?.keepalive)

function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    status.value = await biliApi.status()
  } finally {
    loading.value = false
  }
}

async function checkNow() {
  checking.value = true
  try {
    const state = await biliApi.check()
    status.value = { ...status.value, keepalive: state }
    state.lastCheckOk ? ElMessage.success(state.lastCheckMsg) : ElMessage.warning(state.lastCheckMsg)
  } finally {
    checking.value = false
  }
}

async function renewNow() {
  renewing.value = true
  try {
    const res = await biliApi.renew()
    if (res.ok && res.isLogin) {
      ElMessage.success(`续期成功，登录有效（${res.uname}）`)
    } else if (res.ok) {
      ElMessage.warning('续期完成，但登录校验未通过，建议重新扫码绑定')
    } else {
      ElMessage.error(`续期失败：${res.error || res.lastLines?.join(' / ') || '未知错误'}`)
    }
    load()
  } finally {
    renewing.value = false
  }
}

async function unbind() {
  await ElMessageBox.confirm(
    '解绑将删除服务器上保存的登录凭据，自动投稿与保活随之停用。确定解绑？',
    '解绑B站账号',
    { type: 'warning', confirmButtonText: '解绑', cancelButtonText: '取消' }
  )
  acting.value = true
  try {
    await biliApi.unbind()
    ElMessage.success('已解绑')
    load()
  } finally {
    acting.value = false
  }
}

// ---- 扫码绑定 ----
const bindDialog = ref(false)
const qrDataUrl = ref('')
const qrStatus = ref('') // waiting | scanned | expired | success | error
const qrError = ref('')
let pollTimer = null
let pollGen = 0 // 代际号：刷新二维码后丢弃旧轮询的响应

function stopPolling() {
  pollGen++
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function openBind() {
  bindDialog.value = true
  startQrcode()
}

async function startQrcode() {
  stopPolling()
  const gen = ++pollGen
  qrDataUrl.value = ''
  qrStatus.value = ''
  qrError.value = ''
  try {
    const { authCode, url } = await biliApi.qrcode()
    if (gen !== pollGen) return
    qrDataUrl.value = await QRCode.toDataURL(url, { width: 440, margin: 1 })
    qrStatus.value = 'waiting'
    schedulePoll(authCode, gen)
  } catch (err) {
    if (gen !== pollGen) return
    qrStatus.value = 'error'
    qrError.value = err.response?.data?.error || '获取二维码失败'
  }
}

function schedulePoll(authCode, gen) {
  pollTimer = setTimeout(async () => {
    try {
      const res = await biliApi.qrcodePoll(authCode)
      if (gen !== pollGen) return
      if (res.status === 'success') {
        qrStatus.value = 'success'
        ElMessage.success(`绑定成功：${res.uname}`)
        bindDialog.value = false
        load()
        return
      }
      if (res.status === 'expired') {
        qrStatus.value = 'expired'
        return
      }
      if (res.status === 'error') {
        qrStatus.value = 'error'
        qrError.value = res.message || '扫码登录失败'
        return
      }
      qrStatus.value = res.status // waiting / scanned
      schedulePoll(authCode, gen)
    } catch {
      if (gen !== pollGen) return
      schedulePoll(authCode, gen) // 网络抖动，继续轮询
    }
  }, 2000)
}

onUnmounted(stopPolling)
load()
</script>

<style scoped>
.bili-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 860px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
}

.desc {
  margin-bottom: 16px;
}

.actions {
  display: flex;
  gap: 12px;
}

.tip {
  margin-top: 12px;
}

.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 4px 0 8px;
}

.qr-wrap {
  position: relative;
  width: 220px;
  height: 220px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
}

.qr-img {
  width: 100%;
  height: 100%;
  display: block;
}

.qr-placeholder {
  width: 100%;
  height: 100%;
}

.qr-mask {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.94);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  font-size: 14px;
  color: #606266;
  cursor: pointer;
}

.qr-mask-ok {
  color: var(--el-color-success);
  cursor: default;
}

.qr-hint {
  font-size: 13px;
  color: #909399;
}
</style>
