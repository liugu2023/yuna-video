<template>
  <div v-loading="loading">
    <template v-if="video">
      <div class="toolbar">
        <el-button @click="router.back()">
          <el-icon><ArrowLeft /></el-icon>&nbsp;返回
        </el-button>
        <div class="spacer" />
        <template v-if="isOwner && editable">
          <el-button @click="router.push(`/videos/${video.id}/edit`)">编辑</el-button>
          <el-button type="primary" @click="submit">提交审核</el-button>
        </template>
        <el-button v-if="isOwner && video.status === 'pending'" type="warning" @click="withdraw">撤回审核</el-button>
      </div>

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
            <el-empty v-else description="尚未上传视频文件" :image-size="80" />

            <h2 class="v-title">{{ video.title }}</h2>
            <div class="v-meta">
              <el-tag :type="STATUS_MAP[video.status]?.type">{{ STATUS_MAP[video.status]?.label }}</el-tag>
              <span v-if="video.category" class="text-muted">分区：{{ video.category }}</span>
              <span class="text-muted">大小：{{ formatSize(video.video_size) }}</span>
            </div>
            <div v-if="video.tags?.length" class="v-tags">
              <el-tag v-for="t in video.tags" :key="t" size="small" effect="plain">{{ t }}</el-tag>
            </div>
            <el-alert
              v-if="video.status === 'rejected' && video.reject_reason"
              type="error"
              :closable="false"
              show-icon
              style="margin-top: 12px"
              :title="`驳回原因：${video.reject_reason}`"
            />
            <el-alert
              v-if="video.status === 'published' && video.bilibili_bvid"
              type="success"
              :closable="false"
              show-icon
              style="margin-top: 12px"
            >
              <template #title>
                已发布至B站：
                <el-link type="primary" :href="`https://www.bilibili.com/video/${video.bilibili_bvid}`" target="_blank">
                  {{ video.bilibili_bvid }}
                </el-link>
              </template>
            </el-alert>
            <p v-if="video.description" class="v-desc">{{ video.description }}</p>
          </div>
        </el-col>

        <el-col :span="10">
          <div class="page-card">
            <h4 style="margin-top: 0">稿件信息</h4>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="投稿人">{{ video.uploader_nickname }}（{{ video.uploader_username }}）</el-descriptions-item>
              <el-descriptions-item label="创建时间">{{ video.created_at }}</el-descriptions-item>
              <el-descriptions-item label="提交时间">{{ video.submitted_at || '-' }}</el-descriptions-item>
              <el-descriptions-item label="审核时间">{{ video.reviewed_at || '-' }}</el-descriptions-item>
              <el-descriptions-item label="审核人">{{ video.reviewer_nickname || '-' }}</el-descriptions-item>
              <el-descriptions-item label="发布时间">{{ video.published_at || '-' }}</el-descriptions-item>
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
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { videoApi } from '../api'
import { useUserStore } from '../stores/user'
import { STATUS_MAP, ACTION_MAP, formatSize, isPlayable } from '../utils/constants'

const route = useRoute()
const router = useRouter()
const store = useUserStore()

const loading = ref(true)
const video = ref(null)

const isOwner = computed(() => video.value?.user_id === store.user?.id)
const editable = computed(() => ['draft', 'rejected'].includes(video.value?.status))
const playable = computed(() => isPlayable(video.value?.video_path))

async function load() {
  loading.value = true
  try {
    video.value = await videoApi.get(route.params.id)
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!video.value.video_path) {
    ElMessage.warning('请先编辑稿件并上传视频文件')
    return
  }
  await ElMessageBox.confirm('提交审核后将无法编辑，确定提交吗？', '提交审核', { type: 'warning' })
  await videoApi.submit(video.value.id)
  ElMessage.success('已提交审核')
  load()
}

async function withdraw() {
  await ElMessageBox.confirm('确定撤回审核申请吗？撤回后回到草稿状态。', '撤回', { type: 'warning' })
  await videoApi.withdraw(video.value.id)
  ElMessage.success('已撤回')
  load()
}

onMounted(load)
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

h4 {
  margin: 18px 0 10px;
  color: #303133;
}
</style>
