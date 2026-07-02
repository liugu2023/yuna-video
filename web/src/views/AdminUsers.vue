<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索用户名 / 昵称 / 部门"
        clearable
        style="width: 220px"
        :prefix-icon="Search"
        @keyup.enter="load(1)"
        @clear="load(1)"
      />
      <div class="spacer" />
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>&nbsp;新建账号
      </el-button>
    </div>

    <el-table v-loading="loading" :data="list" style="width: 100%">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="username" label="用户名" width="150" />
      <el-table-column prop="nickname" label="昵称" width="150" />
      <el-table-column label="角色" width="100">
        <template #default="{ row }">
          <el-tag :type="ROLE_MAP[row.role]?.type" effect="light">{{ ROLE_MAP[row.role]?.label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="部门" width="110">
        <template #default="{ row }">{{ row.department || '—' }}</template>
      </el-table-column>
      <el-table-column label="邮箱" min-width="170" show-overflow-tooltip>
        <template #default="{ row }">{{ row.email || '—' }}</template>
      </el-table-column>
      <el-table-column prop="video_count" label="稿件数" width="80" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 'active'"
            :disabled="row.id === store.user?.id"
            active-text="启用"
            inline-prompt
            inactive-text="禁用"
            @change="(val) => toggleStatus(row, val)"
          />
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="170" />
      <el-table-column label="操作" min-width="200">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="warning" @click="openReset(row)">重置密码</el-button>
        </template>
      </el-table-column>
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

    <!-- 新建账号 -->
    <el-dialog v-model="createDialog" title="新建账号" width="440px">
      <el-form ref="createRef" :model="createForm" :rules="createRules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="createForm.username" placeholder="3-20位字母/数字/下划线" />
        </el-form-item>
        <el-form-item label="昵称" prop="nickname">
          <el-input v-model="createForm.nickname" />
        </el-form-item>
        <el-form-item label="初始密码" prop="password">
          <el-input v-model="createForm.password" placeholder="至少6位" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="createForm.role" style="width: 100%">
            <el-option v-for="(v, k) in ROLE_MAP" :key="k" :label="v.label" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="部门">
          <el-select
            v-model="createForm.department"
            style="width: 100%"
            filterable
            allow-create
            default-first-option
            clearable
            placeholder="选择或输入新部门"
          >
            <el-option v-for="d in departments" :key="d" :label="d" :value="d" />
          </el-select>
          <div class="text-muted">主席只审核本部门部长的稿件；不填则不限部门</div>
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="createForm.email" placeholder="可选；主席填了才能收到待审核邮件通知" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="doCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 编辑（昵称/角色/部门/邮箱） -->
    <el-dialog v-model="editDialog" :title="`编辑：${editRow?.username}`" width="440px">
      <el-form label-width="80px">
        <el-form-item label="昵称">
          <el-input v-model="editForm.nickname" maxlength="20" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editForm.role" style="width: 100%" :disabled="editRow?.id === store.user?.id">
            <el-option v-for="(v, k) in ROLE_MAP" :key="k" :label="v.label" :value="k" />
          </el-select>
          <div class="text-muted">主席可审核本部门稿件并发布B站动态；管理员拥有全部权限</div>
        </el-form-item>
        <el-form-item label="部门">
          <el-select
            v-model="editForm.department"
            style="width: 100%"
            filterable
            allow-create
            default-first-option
            clearable
            placeholder="选择或输入新部门"
          >
            <el-option v-for="d in departments" :key="d" :label="d" :value="d" />
          </el-select>
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="editForm.email" placeholder="可选；主席填了才能收到待审核邮件通知" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="doEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog v-model="resetDialog" :title="`重置密码：${resetRow?.username}`" width="440px">
      <el-input v-model="resetPassword" placeholder="输入新密码（至少6位）" />
      <template #footer>
        <el-button @click="resetDialog = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="doReset">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { adminApi } from '../api'
import { useUserStore } from '../stores/user'
import { ROLE_MAP } from '../utils/constants'

const store = useUserStore()

const loading = ref(false)
const acting = ref(false)
const list = ref([])
const total = ref(0)
const departments = ref([])
const query = reactive({ keyword: '', page: 1, pageSize: 20 })

async function load(page) {
  if (page) query.page = page
  loading.value = true
  try {
    const data = await adminApi.users(query)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

async function loadDepartments() {
  try {
    const data = await adminApi.departments()
    departments.value = data.list
  } catch {
    /* 下拉可手动输入，加载失败不影响 */
  }
}

// 新建
const createDialog = ref(false)
const createRef = ref()
const createForm = reactive({ username: '', nickname: '', password: '', role: 'member', department: '', email: '' })
const createRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9_]{3,20}$/, message: '3-20位字母、数字或下划线', trigger: 'blur' },
  ],
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入初始密码', trigger: 'blur' },
    { min: 6, max: 64, message: '密码长度需为6-64位', trigger: 'blur' },
  ],
}

function openCreate() {
  Object.assign(createForm, { username: '', nickname: '', password: '', role: 'member', department: '', email: '' })
  createDialog.value = true
}

async function doCreate() {
  await createRef.value.validate()
  acting.value = true
  try {
    await adminApi.createUser({ ...createForm })
    ElMessage.success('账号已创建')
    createDialog.value = false
    load()
    loadDepartments()
  } finally {
    acting.value = false
  }
}

// 编辑
const editDialog = ref(false)
const editRow = ref(null)
const editForm = reactive({ nickname: '', role: 'member', department: '', email: '' })

function openEdit(row) {
  editRow.value = row
  editForm.nickname = row.nickname
  editForm.role = row.role
  editForm.department = row.department || ''
  editForm.email = row.email || ''
  editDialog.value = true
}

async function doEdit() {
  acting.value = true
  try {
    await adminApi.updateUser(editRow.value.id, { ...editForm })
    ElMessage.success('已保存')
    editDialog.value = false
    load()
    loadDepartments()
  } finally {
    acting.value = false
  }
}

async function toggleStatus(row, val) {
  try {
    await adminApi.updateUser(row.id, { status: val ? 'active' : 'disabled' })
    ElMessage.success(val ? '已启用' : '已禁用')
  } finally {
    load()
  }
}

// 重置密码
const resetDialog = ref(false)
const resetRow = ref(null)
const resetPassword = ref('')

function openReset(row) {
  resetRow.value = row
  resetPassword.value = ''
  resetDialog.value = true
}

async function doReset() {
  if (resetPassword.value.length < 6) {
    ElMessage.warning('密码至少6位')
    return
  }
  acting.value = true
  try {
    await adminApi.resetPassword(resetRow.value.id, resetPassword.value)
    ElMessage.success('密码已重置')
    resetDialog.value = false
  } finally {
    acting.value = false
  }
}

onMounted(() => {
  load()
  loadDepartments()
})
</script>
