<template>
  <div v-loading="loading">
    <div class="toolbar">
      <h3 style="margin: 0">我的稿件概况</h3>
      <div class="spacer" />
      <el-button type="primary" @click="router.push('/videos/new')">
        <el-icon><UploadFilled /></el-icon>&nbsp;新建投稿
      </el-button>
      <el-button v-if="store.isReviewer" @click="router.push('/review')">
        <el-icon><Checked /></el-icon>&nbsp;前往审核
      </el-button>
    </div>

    <el-row :gutter="16">
      <el-col v-for="card in mineCards" :key="card.label" :span="4">
        <div class="stat-card" @click="goVideos(card.status)">
          <div class="stat-num" :style="{ color: card.color }">{{ card.value }}</div>
          <div class="stat-label">{{ card.label }}</div>
        </div>
      </el-col>
    </el-row>

    <template v-if="data.site">
      <h3>全站审核概况</h3>
      <el-row :gutter="16">
        <el-col :span="4">
          <div class="stat-card highlight" @click="router.push('/review')">
            <div class="stat-num" style="color: #e6a23c">{{ data.site.pending }}</div>
            <div class="stat-label">待审核稿件</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-card">
            <div class="stat-num" style="color: #67c23a">{{ data.site.todayReviewed }}</div>
            <div class="stat-label">今日已审</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-card">
            <div class="stat-num" style="color: #67c23a">{{ data.site.approved }}</div>
            <div class="stat-label">已通过待发布</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-card">
            <div class="stat-num" style="color: #fb7299">{{ data.site.published }}</div>
            <div class="stat-label">已发布</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="stat-card">
            <div class="stat-num">{{ data.site.total }}</div>
            <div class="stat-label">全站稿件</div>
          </div>
        </el-col>
        <el-col v-if="data.userCount !== undefined" :span="4">
          <div class="stat-card" @click="router.push('/admin/users')">
            <div class="stat-num">{{ data.userCount }}</div>
            <div class="stat-label">协会成员</div>
          </div>
        </el-col>
      </el-row>
    </template>

    <h3>最近动态</h3>
    <div class="page-card">
      <el-empty v-if="!data.recentLogs?.length" description="暂无动态" :image-size="80" />
      <el-timeline v-else style="padding-left: 4px">
        <el-timeline-item
          v-for="log in data.recentLogs"
          :key="log.id"
          :timestamp="log.created_at"
          :type="ACTION_MAP[log.action]?.type"
        >
          <span class="log-line">
            <b>{{ log.operator_nickname || '未知用户' }}</b>
            <el-tag size="small" :type="ACTION_MAP[log.action]?.type" effect="light">
              {{ ACTION_MAP[log.action]?.label || log.action }}
            </el-tag>
            <el-link
              v-if="log.video_title"
              type="primary"
              :underline="false"
              @click="goLogVideo(log)"
            >
              《{{ log.video_title }}》
            </el-link>
            <span v-else class="text-muted">（稿件已删除）</span>
            <span v-if="log.comment" class="text-muted">：{{ log.comment }}</span>
          </span>
        </el-timeline-item>
      </el-timeline>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { statsApi } from '../api'
import { useUserStore } from '../stores/user'
import { ACTION_MAP } from '../utils/constants'

const router = useRouter()
const store = useUserStore()
const loading = ref(true)
const data = ref({ mine: {}, recentLogs: [] })

const mineCards = computed(() => [
  { label: '全部稿件', value: data.value.mine.total ?? 0, status: '', color: '#303133' },
  { label: '草稿', value: data.value.mine.draft ?? 0, status: 'draft', color: '#909399' },
  { label: '待审核', value: data.value.mine.pending ?? 0, status: 'pending', color: '#e6a23c' },
  { label: '已通过', value: data.value.mine.approved ?? 0, status: 'approved', color: '#67c23a' },
  { label: '已驳回', value: data.value.mine.rejected ?? 0, status: 'rejected', color: '#f56c6c' },
  { label: '已发布', value: data.value.mine.published ?? 0, status: 'published', color: '#fb7299' },
])

function goVideos(status) {
  router.push({ path: '/videos', query: status ? { status } : {} })
}

function goLogVideo(log) {
  if (!log.video_id) return
  // 自己的稿件走稿件详情；审核员看别人的稿件走审核详情
  if (log.video_user_id === store.user.id || !store.isReviewer) {
    router.push(`/videos/${log.video_id}`)
  } else {
    router.push(`/review/${log.video_id}`)
  }
}

onMounted(async () => {
  try {
    data.value = await statsApi.dashboard()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
h3 {
  margin: 24px 0 14px;
  color: #303133;
}

.stat-card {
  background: #fff;
  border-radius: 8px;
  padding: 18px 16px;
  text-align: center;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  transition: transform 0.15s, box-shadow 0.15s;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.stat-card.highlight {
  border: 1px solid var(--el-color-primary-light-7);
}

.stat-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

.stat-label {
  margin-top: 6px;
  color: #909399;
  font-size: 13px;
}

.log-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
