<template>
  <div class="page-card">
    <div class="toolbar">
      <el-radio-group v-model="query.status" @change="load(1)">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button v-for="(v, k) in STATUS_MAP" :key="k" :value="k">{{ v.label }}</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="query.keyword"
        placeholder="搜索标题"
        clearable
        style="width: 220px"
        :prefix-icon="Search"
        @keyup.enter="load(1)"
        @clear="load(1)"
      />
      <div class="spacer" />
      <el-button type="primary" @click="router.push('/videos/new')">
        <el-icon><UploadFilled /></el-icon>&nbsp;新建投稿
      </el-button>
    </div>

    <el-table v-loading="loading" :data="list" style="width: 100%">
      <el-table-column label="封面" width="120">
        <template #default="{ row }">
          <el-image
            :src="row.cover_path || undefined"
            fit="cover"
            style="width: 96px; height: 60px; border-radius: 4px; background: #f0f2f5"
          >
            <template #error>
              <div class="no-cover"><el-icon><Picture /></el-icon></div>
            </template>
          </el-image>
        </template>
      </el-table-column>
      <el-table-column label="标题" min-width="220">
        <template #default="{ row }">
          <el-link type="primary" :underline="false" @click="router.push(`/videos/${row.id}`)">
            {{ row.title }}
          </el-link>
          <div class="text-muted" v-if="row.video_name">{{ row.video_name }} · {{ formatSize(row.video_size) }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="category" label="分区" width="110">
        <template #default="{ row }">{{ row.category || '-' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tooltip v-if="row.status === 'rejected' && row.reject_reason" :content="`驳回原因：${row.reject_reason}`">
            <el-tag :type="STATUS_MAP[row.status]?.type">{{ STATUS_MAP[row.status]?.label }}</el-tag>
          </el-tooltip>
          <el-tag v-else :type="STATUS_MAP[row.status]?.type">{{ STATUS_MAP[row.status]?.label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updated_at" label="更新时间" width="170" />
      <el-table-column label="操作" width="290" fixed="right">
        <template #default="{ row }">
          <div class="row-ops">
            <el-button size="small" @click="router.push(`/videos/${row.id}`)">详情</el-button>
            <el-button v-if="editable(row)" size="small" @click="router.push(`/videos/${row.id}/edit`)">编辑</el-button>
            <el-button v-if="editable(row)" size="small" type="primary" @click="submit(row)">提交审核</el-button>
            <el-button v-if="row.status === 'pending'" size="small" type="warning" @click="withdraw(row)">撤回</el-button>
            <el-button v-if="editable(row)" size="small" type="danger" @click="remove(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="还没有稿件，点击右上角新建投稿" :image-size="90" />
      </template>
    </el-table>

    <el-pagination
      v-if="total > query.pageSize"
      v-model:current-page="query.page"
      :page-size="query.pageSize"
      :total="total"
      layout="total, prev, pager, next"
      background
      style="margin-top: 16px; justify-content: flex-end"
      @current-change="load()"
    />
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { videoApi } from '../api'
import { STATUS_MAP, formatSize } from '../utils/constants'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({
  status: typeof route.query.status === 'string' ? route.query.status : '',
  keyword: '',
  page: 1,
  pageSize: 10,
})

function editable(row) {
  return ['draft', 'rejected'].includes(row.status)
}

async function load(page) {
  if (page) query.page = page
  loading.value = true
  try {
    const data = await videoApi.list(query)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

async function submit(row) {
  if (!row.video_path) {
    ElMessage.warning('该稿件还没有上传视频文件，请先编辑补充')
    return
  }
  await ElMessageBox.confirm(`确定将《${row.title}》提交审核吗？`, '提交审核', { type: 'warning' })
  await videoApi.submit(row.id)
  ElMessage.success('已提交审核')
  load()
}

async function withdraw(row) {
  await ElMessageBox.confirm(`确定撤回《${row.title}》的审核申请吗？撤回后回到草稿状态。`, '撤回', {
    type: 'warning',
  })
  await videoApi.withdraw(row.id)
  ElMessage.success('已撤回')
  load()
}

async function remove(row) {
  await ElMessageBox.confirm(`确定删除《${row.title}》吗？视频文件将一并删除，不可恢复。`, '删除稿件', {
    type: 'error',
    confirmButtonText: '删除',
  })
  await videoApi.remove(row.id)
  ElMessage.success('已删除')
  load()
}

onMounted(() => load())
</script>

<style scoped>
.no-cover {
  width: 96px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  background: #f0f2f5;
  border-radius: 4px;
}

/* 操作按钮用 gap 排列：数量多换行时也能对齐（覆盖相邻按钮的默认 margin） */
.row-ops {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.row-ops .el-button {
  margin-left: 0;
}
</style>
