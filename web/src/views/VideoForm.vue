<template>
  <div class="form-wrap page-card" v-loading="pageLoading">
    <el-alert
      v-if="form.status === 'rejected'"
      type="error"
      :closable="false"
      style="margin-bottom: 18px"
      show-icon
    >
      <template #title>该稿件被驳回：{{ rejectReason || '无具体原因' }}</template>
      修改后可重新提交审核
    </el-alert>

    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="视频文件" required>
        <div style="width: 100%">
          <template v-if="!form.videoPath && !uploading">
            <el-upload
              drag
              :show-file-list="false"
              :http-request="doUploadVideo"
              accept=".mp4,.m4v,.mov,.flv,.avi,.wmv,.webm,.mkv,.ts,.mpg,.mpeg"
            >
              <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
              <div class="el-upload__text">将视频拖到此处，或<em>点击上传</em></div>
              <template #tip>
                <div class="el-upload__tip">支持 mp4 / mov / flv / avi / wmv / webm / mkv 等，单个文件不超过 8GB；推荐 mp4 以便在线预览</div>
              </template>
            </el-upload>
          </template>

          <div v-else-if="uploading" class="upload-progress">
            <el-progress :percentage="progress" :stroke-width="14" striped striped-flow />
            <div class="text-muted" style="margin-top: 6px">正在上传 {{ uploadingName }}，请勿关闭页面…</div>
          </div>

          <div v-else class="video-file">
            <el-icon color="#67c23a" :size="20"><SuccessFilled /></el-icon>
            <span class="file-name">{{ form.videoName || form.videoPath }}</span>
            <span class="text-muted">{{ formatSize(form.videoSize) }}</span>
            <el-upload
              :show-file-list="false"
              :http-request="doUploadVideo"
              accept=".mp4,.m4v,.mov,.flv,.avi,.wmv,.webm,.mkv,.ts,.mpg,.mpeg"
            >
              <el-button size="small">重新上传</el-button>
            </el-upload>
          </div>
        </div>
      </el-form-item>

      <el-form-item label="封面">
        <div>
          <el-upload :show-file-list="false" :http-request="doUploadCover" accept=".jpg,.jpeg,.png,.webp">
            <div class="cover-box">
              <img v-if="form.coverPath" :src="form.coverPath" alt="封面" />
              <div v-else class="cover-placeholder">
                <el-icon :size="24"><Plus /></el-icon>
                <span>上传封面</span>
              </div>
            </div>
          </el-upload>
          <div class="text-muted" style="margin-top: 6px">建议尺寸 1146×717（16:10），支持 jpg / png / webp，不超过10MB</div>
        </div>
      </el-form-item>

      <el-form-item label="标题" prop="title">
        <el-input v-model="form.title" maxlength="80" show-word-limit placeholder="填写清晰有吸引力的标题" />
      </el-form-item>

      <el-form-item label="分区" prop="category">
        <el-select v-model="form.category" placeholder="选择投稿分区" style="width: 260px">
          <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
        </el-select>
      </el-form-item>

      <el-form-item label="标签">
        <el-select
          v-model="form.tags"
          multiple
          filterable
          allow-create
          default-first-option
          :multiple-limit="10"
          placeholder="输入标签后回车创建，最多10个"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="简介">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="6"
          maxlength="2000"
          show-word-limit
          placeholder="介绍一下这个视频吧～"
        />
      </el-form-item>

      <el-form-item>
        <el-button :loading="saving" @click="save(false)">保存草稿</el-button>
        <el-button type="primary" :loading="saving" @click="save(true)">保存并提交审核</el-button>
        <el-button text @click="router.back()">取消</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { videoApi, uploadApi } from '../api'
import { CATEGORIES, formatSize } from '../utils/constants'

const route = useRoute()
const router = useRouter()
const editId = route.params.id ? Number(route.params.id) : null

const pageLoading = ref(false)
const saving = ref(false)
const uploading = ref(false)
const uploadingName = ref('')
const progress = ref(0)
const rejectReason = ref('')

const formRef = ref()
const form = reactive({
  title: '',
  description: '',
  tags: [],
  category: '',
  coverPath: '',
  videoPath: '',
  videoName: '',
  videoSize: 0,
  status: 'draft',
})

const rules = {
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分区', trigger: 'change' }],
}

async function doUploadVideo({ file }) {
  uploading.value = true
  uploadingName.value = file.name
  progress.value = 0
  try {
    const data = await uploadApi.video(file, (p) => (progress.value = p))
    form.videoPath = data.path
    form.videoName = data.name
    form.videoSize = data.size
    // 未填标题时用文件名自动填充
    if (!form.title) {
      form.title = data.name.replace(/\.[^.]+$/, '').slice(0, 80)
    }
    ElMessage.success('视频上传完成')
  } finally {
    uploading.value = false
  }
}

async function doUploadCover({ file }) {
  const data = await uploadApi.cover(file)
  form.coverPath = data.path
}

async function save(submitAfter) {
  await formRef.value.validate()
  if (!form.videoPath) {
    ElMessage.warning('请先上传视频文件')
    return
  }
  if (submitAfter) {
    await ElMessageBox.confirm('保存并提交审核后将无法编辑，确定提交吗？', '提交审核', { type: 'warning' })
  }

  saving.value = true
  try {
    const payload = {
      title: form.title,
      description: form.description,
      tags: form.tags,
      category: form.category,
      coverPath: form.coverPath,
      videoPath: form.videoPath,
      videoName: form.videoName,
      videoSize: form.videoSize,
    }
    const saved = editId ? await videoApi.update(editId, payload) : await videoApi.create(payload)
    if (submitAfter) {
      await videoApi.submit(saved.id)
      ElMessage.success('已提交审核')
    } else {
      ElMessage.success('已保存草稿')
    }
    router.push('/videos')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  if (!editId) return
  pageLoading.value = true
  try {
    const v = await videoApi.get(editId)
    if (!['draft', 'rejected'].includes(v.status)) {
      ElMessage.warning('当前状态的稿件不可编辑')
      router.replace(`/videos/${editId}`)
      return
    }
    form.title = v.title
    form.description = v.description
    form.tags = v.tags || []
    form.category = v.category
    form.coverPath = v.cover_path
    form.videoPath = v.video_path
    form.videoName = v.video_name
    form.videoSize = v.video_size
    form.status = v.status
    rejectReason.value = v.reject_reason
  } finally {
    pageLoading.value = false
  }
})
</script>

<style scoped>
.form-wrap {
  max-width: 860px;
}

.upload-progress {
  width: 100%;
  padding: 12px 0;
}

.video-file {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f7f8fa;
  border-radius: 6px;
  padding: 10px 14px;
  width: 100%;
}

.file-name {
  font-weight: 500;
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cover-box {
  width: 229px;
  height: 143px; /* 16:10 */
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafafa;
}

.cover-box:hover {
  border-color: var(--el-color-primary);
}

.cover-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #909399;
  font-size: 13px;
}
</style>
