<template>
  <div class="dyn-page">
    <!-- 发布 -->
    <div class="page-card">
      <div class="card-title">
        <span>发布B站动态</span>
        <el-tag v-if="state?.bound && state?.uname" type="success" effect="light" size="small">
          {{ state.uname }}
        </el-tag>
      </div>

      <el-alert
        v-if="state && !state.bound"
        type="warning"
        :closable="false"
        show-icon
        class="tip-block"
        title="尚未绑定B站账号，无法发布动态。请联系管理员在「B站账号」页面扫码绑定。"
      />

      <el-input
        v-model="text"
        type="textarea"
        :rows="5"
        :maxlength="1000"
        show-word-limit
        resize="vertical"
        placeholder="以协会账号发布动态：公告、活动宣传、新视频预告……"
      />

      <el-upload
        v-model:file-list="fileList"
        class="pic-upload"
        list-type="picture-card"
        accept=".jpg,.jpeg,.png,.gif"
        :auto-upload="false"
        :limit="9"
        :on-change="onFileChange"
        :on-exceed="() => ElMessage.warning('图片最多 9 张')"
        multiple
      >
        <el-icon><Plus /></el-icon>
      </el-upload>
      <div class="text-muted">配图可选，最多 9 张，支持 jpg / png / gif，单张不超过 20MB。</div>

      <div class="actions">
        <el-button
          type="primary"
          :loading="posting"
          :disabled="!state?.bound || !text.trim()"
          @click="publish"
        >
          <el-icon><Promotion /></el-icon>&nbsp;发布动态
        </el-button>
        <span v-if="posting" class="text-muted">{{ postingHint }}</span>
      </div>

      <el-alert v-if="lastPost" type="success" :closable="true" class="tip-block" @close="lastPost = null">
        <template #title>
          发布成功！
          <el-link type="primary" :href="lastPost.url" target="_blank" style="vertical-align: baseline">
            查看动态
          </el-link>
        </template>
      </el-alert>
    </div>

    <!-- 历史 -->
    <div class="page-card">
      <div class="card-title"><span>发布历史</span></div>
      <el-table v-loading="loadingHistory" :data="history" style="width: 100%">
        <el-table-column prop="created_at" label="时间" width="170" />
        <el-table-column prop="user_nickname" label="发布人" width="130" />
        <el-table-column prop="text" label="内容" min-width="240" show-overflow-tooltip />
        <el-table-column label="配图" width="70">
          <template #default="{ row }">{{ row.image_count || '—' }}</template>
        </el-table-column>
        <el-table-column label="链接" width="110">
          <template #default="{ row }">
            <el-link type="primary" :href="`https://t.bilibili.com/${row.dyn_id}`" target="_blank">查看</el-link>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loadingHistory && !history.length" description="还没有发布过动态" :image-size="80" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { biliApi } from '../api'

const state = ref(null)
const text = ref('')
const fileList = ref([])
const posting = ref(false)
const postingHint = ref('')
const lastPost = ref(null)
const history = ref([])
const loadingHistory = ref(false)

async function loadState() {
  state.value = await biliApi.dynamicState()
}

async function loadHistory() {
  loadingHistory.value = true
  try {
    const data = await biliApi.dynamicHistory()
    history.value = data.list
  } finally {
    loadingHistory.value = false
  }
}

// auto-upload 关闭时 el-upload 不做校验，这里手动把不合规的文件剔除
function onFileChange(file, files) {
  const bad =
    (!/\.(jpe?g|png|gif)$/i.test(file.name) && '仅支持 jpg / png / gif 格式') ||
    (file.size > 20 * 1024 * 1024 && '单张图片不能超过 20MB')
  if (bad) {
    ElMessage.warning(`「${file.name}」${bad}`)
    fileList.value = files.filter((f) => f.uid !== file.uid)
  }
}

async function publish() {
  posting.value = true
  postingHint.value = fileList.value.length ? `正在上传 ${fileList.value.length} 张图片并发布…` : '正在发布…'
  try {
    const fd = new FormData()
    fd.append('text', text.value.trim())
    for (const f of fileList.value) fd.append('images', f.raw)
    const res = await biliApi.postDynamic(fd)
    lastPost.value = res
    ElMessage.success('动态已发布')
    text.value = ''
    fileList.value = []
    loadHistory()
  } finally {
    posting.value = false
  }
}

loadState()
loadHistory()
</script>

<style scoped>
.dyn-page {
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

.pic-upload {
  margin-top: 14px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.tip-block {
  margin-top: 14px;
  margin-bottom: 14px;
}
</style>
