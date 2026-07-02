<template>
  <div v-loading="loading">
    <template v-if="video">
      <div class="toolbar">
        <el-button @click="router.push('/review')">
          <el-icon><ArrowLeft /></el-icon>&nbsp;返回审核中心
        </el-button>
      </div>

      <el-alert
        v-if="video.user_id === store.user?.id"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
        title="注意：这是你自己提交的稿件，建议由其他审核员处理"
      />

      <el-row :gutter="16">
        <el-col :span="14">
          <div class="page-card">
            <video
              v-if="video.video_path && playable"
              :src="video.video_path"
              :poster="video.cover_path || undefined"
              controls
              preload="metadata"
              class="player"
            />
            <el-alert v-else-if="video.video_path" type="info" :closable="false" show-icon>
              <template #title>
                该格式（{{ video.video_name }}）浏览器可能无法在线预览，
                <el-link type="primary" :href="video.video_path" target="_blank" download>点击下载查看</el-link>
              </template>
            </el-alert>
            <el-empty v-else description="投稿人未上传视频文件" :image-size="80" />

            <h2 class="v-title">{{ video.title }}</h2>
            <div class="v-meta">
              <el-tag :type="STATUS_MAP[video.status]?.type">{{ STATUS_MAP[video.status]?.label }}</el-tag>
              <span class="text-muted">分区：{{ video.category || '未选择' }}</span>
              <span class="text-muted">大小：{{ formatSize(video.video_size) }}</span>
              <span class="text-muted">文件：{{ video.video_name || '-' }}</span>
            </div>
            <div v-if="video.tags?.length" class="v-tags">
              <el-tag v-for="t in video.tags" :key="t" size="small" effect="plain">{{ t }}</el-tag>
            </div>
            <p class="v-desc">{{ video.description || '（无简介）' }}</p>

            <template v-if="video.cover_path">
              <h4>封面预览</h4>
              <el-image :src="video.cover_path" fit="cover" style="width: 286px; height: 179px; border-radius: 6px" />
            </template>
          </div>
        </el-col>

        <el-col :span="10">
          <div class="page-card action-card">
            <h4 style="margin-top: 0">审核操作</h4>

            <template v-if="video.status === 'pending'">
              <el-input
                v-model="comment"
                type="textarea"
                :rows="4"
                maxlength="500"
                show-word-limit
                placeholder="审核意见（通过时选填，驳回时必填）"
              />
              <div class="action-btns">
                <el-button type="success" :loading="acting" @click="approve">
                  <el-icon><CircleCheck /></el-icon>&nbsp;通过
                </el-button>
                <el-button type="danger" :loading="acting" @click="reject">
                  <el-icon><CircleClose /></el-icon>&nbsp;驳回
                </el-button>
              </div>
            </template>

            <template v-else-if="video.status === 'approved'">
              <el-alert type="success" :closable="false" show-icon title="审核已通过，等待发布到B站" style="margin-bottom: 12px" />

              <template v-if="autoPublishEnabled">
                <el-divider content-position="left">方式一：自动投稿（biliup）</el-divider>
                <el-form label-width="70px" label-position="left">
                  <el-form-item label="分区tid">
                    <el-select
                      v-model="tid"
                      filterable
                      allow-create
                      default-first-option
                      placeholder="选择或输入B站分区ID"
                      style="width: 100%"
                    >
                      <el-option v-for="o in TID_OPTIONS" :key="o.value" :label="`${o.label} (${o.value})`" :value="o.value" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="标签">
                    <el-select
                      v-model="pubTags"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      :multiple-limit="10"
                      placeholder="至少1个标签，回车创建"
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-form>
                <el-button type="primary" :loading="jobRunning" style="width: 100%" @click="startAuto">
                  {{ jobRunning ? '投稿进行中…' : '以协会账号自动投稿' }}
                </el-button>

                <div v-if="job" style="margin-top: 12px">
                  <el-alert v-if="job.status === 'running'" type="info" :closable="false" show-icon>
                    <template #title>正在上传投稿，请勿关闭服务…</template>
                    <div class="job-line">{{ job.lastLines?.[job.lastLines.length - 1] || '启动中…' }}</div>
                  </el-alert>
                  <el-alert v-else-if="job.status === 'succeeded' && !job.bvid" type="warning" :closable="false" show-icon
                    title="biliup 执行成功，但未识别到BV号，请到B站创作中心确认后人工回填" />
                  <el-alert v-else-if="job.status === 'failed'" type="error" :closable="false" show-icon>
                    <template #title>自动投稿失败：{{ job.error }}</template>
                    <pre class="job-output">{{ (job.lastLines || []).join('\n') }}</pre>
                  </el-alert>
                </div>

                <el-divider content-position="left">方式二：人工投稿后回填BV号</el-divider>
              </template>

              <el-input v-model="bvid" placeholder="发布后填写BV号，例如 BV1xx411c7XX" />
              <div class="action-btns">
                <el-button type="primary" :loading="acting" @click="publish">标记已发布</el-button>
              </div>
            </template>

            <el-alert
              v-else-if="video.status === 'published'"
              type="success"
              :closable="false"
              show-icon
            >
              <template #title>
                已发布：
                <el-link type="primary" :href="`https://www.bilibili.com/video/${video.bilibili_bvid}`" target="_blank">
                  {{ video.bilibili_bvid }}
                </el-link>
              </template>
            </el-alert>

            <el-alert
              v-else-if="video.status === 'rejected'"
              type="error"
              :closable="false"
              show-icon
              :title="`已驳回：${video.reject_reason || '无具体原因'}`"
            />

            <el-alert v-else type="info" :closable="false" show-icon title="稿件在草稿状态，等待投稿人提交" />

            <h4>投稿人</h4>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="昵称">{{ video.uploader_nickname }}</el-descriptions-item>
              <el-descriptions-item label="用户名">@{{ video.uploader_username }}</el-descriptions-item>
              <el-descriptions-item label="提交时间">{{ video.submitted_at || '-' }}</el-descriptions-item>
            </el-descriptions>

            <h4>操作记录</h4>
            <el-empty v-if="!video.logs?.length" description="暂无记录" :image-size="60" />
            <el-timeline v-else style="padding-left: 4px">
              <el-timeline-item
                v-for="log in video.logs"
                :key="log.id"
                :timestamp="log.created_at"
                :type="ACTION_MAP[log.action]?.type"
              >
                <b>{{ log.operator_nickname || '未知用户' }}</b>
                {{ ACTION_MAP[log.action]?.label || log.action }}
                <div v-if="log.comment" class="text-muted">{{ log.comment }}</div>
              </el-timeline-item>
            </el-timeline>
          </div>
        </el-col>
      </el-row>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { reviewApi } from '../api'
import { useUserStore } from '../stores/user'
import { STATUS_MAP, ACTION_MAP, TID_OPTIONS, formatSize, isPlayable } from '../utils/constants'

const route = useRoute()
const router = useRouter()
const store = useUserStore()

const loading = ref(true)
const acting = ref(false)
const video = ref(null)
const comment = ref('')
const bvid = ref('')

// biliup 自动投稿
const autoPublishEnabled = ref(false)
const tid = ref(21)
const pubTags = ref([])
const job = ref(null)
let pollTimer = null

const playable = computed(() => isPlayable(video.value?.video_path))
const jobRunning = computed(() => job.value?.status === 'running')

async function load() {
  loading.value = true
  try {
    video.value = await reviewApi.get(route.params.id)
    if (!pubTags.value.length && video.value.tags?.length) {
      pubTags.value = [...video.value.tags]
    }
  } finally {
    loading.value = false
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function pollJob(jobId) {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const j = await reviewApi.publishJob(jobId)
      job.value = j
      if (j.status !== 'running') {
        stopPolling()
        if (j.status === 'succeeded' && j.bvid) {
          ElMessage.success(`自动投稿成功：${j.bvid}`)
          load()
        }
      }
    } catch {
      stopPolling()
    }
  }, 2000)
}

async function startAuto() {
  const tidNum = Number(tid.value)
  if (!Number.isInteger(tidNum) || tidNum < 1) {
    ElMessage.warning('请填写有效的分区ID（数字）')
    return
  }
  if (!pubTags.value.length) {
    ElMessage.warning('B站投稿至少需要1个标签')
    return
  }
  await ElMessageBox.confirm(
    `将以协会B站账号自动投稿《${video.value.title}》，投稿成功后自动回填BV号。确定继续吗？`,
    '自动投稿',
    { type: 'warning' }
  )
  const j = await reviewApi.autoPublish(video.value.id, { tid: tidNum, tags: pubTags.value })
  job.value = j
  pollJob(j.id)
}

async function approve() {
  await ElMessageBox.confirm(`确定通过《${video.value.title}》吗？`, '审核通过', { type: 'success' })
  acting.value = true
  try {
    await reviewApi.approve(video.value.id, comment.value.trim())
    ElMessage.success('已通过审核')
    comment.value = ''
    load()
  } finally {
    acting.value = false
  }
}

async function reject() {
  if (!comment.value.trim()) {
    ElMessage.warning('驳回时必须填写审核意见')
    return
  }
  await ElMessageBox.confirm(`确定驳回《${video.value.title}》吗？`, '驳回稿件', { type: 'warning' })
  acting.value = true
  try {
    await reviewApi.reject(video.value.id, comment.value.trim())
    ElMessage.success('已驳回')
    comment.value = ''
    load()
  } finally {
    acting.value = false
  }
}

async function publish() {
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid.value.trim())) {
    ElMessage.warning('请输入正确的BV号（例如 BV1xx411c7XX）')
    return
  }
  acting.value = true
  try {
    await reviewApi.publish(video.value.id, bvid.value.trim())
    ElMessage.success('已标记为发布')
    bvid.value = ''
    load()
  } finally {
    acting.value = false
  }
}

onMounted(async () => {
  load()
  try {
    const cfg = await reviewApi.publishConfig()
    autoPublishEnabled.value = cfg.autoPublishEnabled
  } catch {
    /* 未配置时静默 */
  }
})

onUnmounted(stopPolling)
</script>

<style scoped>
.player {
  width: 100%;
  max-height: 420px;
  background: #000;
  border-radius: 6px;
}

.v-title {
  margin: 14px 0 8px;
  color: #303133;
}

.v-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.v-tags {
  margin-top: 10px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.v-desc {
  margin-top: 14px;
  color: #606266;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.action-card h4 {
  margin: 18px 0 10px;
}

.action-btns {
  margin-top: 12px;
  display: flex;
  gap: 10px;
}

.job-line {
  font-size: 12px;
  color: #606266;
  word-break: break-all;
}

.job-output {
  margin: 6px 0 0;
  max-height: 160px;
  overflow: auto;
  font-size: 12px;
  background: #f7f8fa;
  border-radius: 4px;
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
