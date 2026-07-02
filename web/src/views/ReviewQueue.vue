<template>
  <div class="page-card">
    <el-tabs v-model="query.status" @tab-change="load(1)">
      <el-tab-pane label="待审核" name="pending" />
      <el-tab-pane label="已通过" name="approved" />
      <el-tab-pane label="已发布" name="published" />
      <el-tab-pane label="已驳回" name="rejected" />
      <el-tab-pane label="全部" name="" />
    </el-tabs>

    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索标题 / 投稿人"
        clearable
        style="width: 240px"
        :prefix-icon="Search"
        @keyup.enter="load(1)"
        @clear="load(1)"
      />
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
          <el-link type="primary" :underline="false" @click="router.push(`/review/${row.id}`)">
            {{ row.title }}
          </el-link>
          <div class="text-muted">{{ formatSize(row.video_size) }} · {{ row.category || '未分区' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="投稿人" width="140">
        <template #default="{ row }">
          {{ row.uploader_nickname }}
          <div class="text-muted">@{{ row.uploader_username }}</div>
        </template>
      </el-table-column>
      <el-table-column label="部门" width="110">
        <template #default="{ row }">{{ row.uploader_department || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="STATUS_MAP[row.status]?.type">{{ STATUS_MAP[row.status]?.label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" prop="submitted_at" width="170">
        <template #default="{ row }">{{ row.submitted_at || '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'pending'" size="small" type="primary" @click="router.push(`/review/${row.id}`)">
            审核
          </el-button>
          <el-button v-else size="small" @click="router.push(`/review/${row.id}`)">查看</el-button>
          <el-button v-if="row.status === 'approved'" size="small" type="success" @click="openPublish(row)">
            标记发布
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="暂无稿件" :image-size="90" />
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

    <el-dialog v-model="publishDialog" title="标记发布到B站" width="440px">
      <p class="text-muted" style="margin-top: 0">
        请先手动将《{{ publishRow?.title }}》上传至协会B站账号，发布成功后在此填写BV号归档。
      </p>
      <el-input v-model="bvid" placeholder="BV号，例如 BV1xx411c7XX" />
      <template #footer>
        <el-button @click="publishDialog = false">取消</el-button>
        <el-button type="primary" :loading="publishing" @click="doPublish">确认发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { reviewApi } from '../api'
import { STATUS_MAP, formatSize } from '../utils/constants'

const router = useRouter()

const loading = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({ status: 'pending', keyword: '', page: 1, pageSize: 10 })

const publishDialog = ref(false)
const publishing = ref(false)
const publishRow = ref(null)
const bvid = ref('')

async function load(page) {
  if (page) query.page = page
  loading.value = true
  try {
    const data = await reviewApi.list(query)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function openPublish(row) {
  publishRow.value = row
  bvid.value = ''
  publishDialog.value = true
}

async function doPublish() {
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid.value.trim())) {
    ElMessage.warning('请输入正确的BV号（例如 BV1xx411c7XX）')
    return
  }
  publishing.value = true
  try {
    await reviewApi.publish(publishRow.value.id, bvid.value.trim())
    ElMessage.success('已标记为发布')
    publishDialog.value = false
    load()
  } finally {
    publishing.value = false
  }
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
</style>
