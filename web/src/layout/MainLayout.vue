<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo" @click="router.push('/')">
        <el-icon :size="26"><VideoPlay /></el-icon>
        <span>投稿审核平台</span>
      </div>
      <el-menu :default-active="activeMenu" router class="menu">
        <el-menu-item index="/">
          <el-icon><Odometer /></el-icon>
          <span>工作台</span>
        </el-menu-item>
        <el-menu-item index="/videos">
          <el-icon><Film /></el-icon>
          <span>我的稿件</span>
        </el-menu-item>
        <el-menu-item index="/videos/new">
          <el-icon><UploadFilled /></el-icon>
          <span>新建投稿</span>
        </el-menu-item>
        <el-menu-item v-if="store.isReviewer" index="/review">
          <el-icon><Checked /></el-icon>
          <span>审核中心</span>
        </el-menu-item>
        <el-menu-item v-if="store.isReviewer" index="/bili/dynamic">
          <el-icon><ChatDotRound /></el-icon>
          <span>B站动态</span>
        </el-menu-item>
        <el-menu-item v-if="store.isAdmin" index="/admin/users">
          <el-icon><User /></el-icon>
          <span>成员管理</span>
        </el-menu-item>
        <el-menu-item v-if="store.isAdmin" index="/admin/bilibili">
          <el-icon><Connection /></el-icon>
          <span>B站账号</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="page-title">{{ route.meta.title }}</div>
        <div class="header-right">
          <el-tag v-if="store.user" :type="ROLE_MAP[store.user.role]?.type" effect="light" round>
            {{ ROLE_MAP[store.user.role]?.label }}
          </el-tag>
          <el-dropdown @command="onCommand">
            <span class="user-name">
              {{ store.user?.nickname }}
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>

  <el-dialog v-model="pwdDialog" title="修改密码" width="420px">
    <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="80px">
      <el-form-item label="原密码" prop="oldPassword">
        <el-input v-model="pwdForm.oldPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input v-model="pwdForm.newPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="确认密码" prop="confirm">
        <el-input v-model="pwdForm.confirm" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="pwdDialog = false">取消</el-button>
      <el-button type="primary" :loading="pwdLoading" @click="changePassword">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../stores/user'
import { authApi } from '../api'
import { ROLE_MAP } from '../utils/constants'

const route = useRoute()
const router = useRouter()
const store = useUserStore()

const activeMenu = computed(() => {
  const p = route.path
  if (p === '/videos/new') return '/videos/new'
  if (p.startsWith('/videos')) return '/videos'
  if (p.startsWith('/review')) return '/review'
  if (p.startsWith('/bili/dynamic')) return '/bili/dynamic'
  if (p.startsWith('/admin/bilibili')) return '/admin/bilibili'
  if (p.startsWith('/admin')) return '/admin/users'
  return '/'
})

const pwdDialog = ref(false)
const pwdLoading = ref(false)
const pwdFormRef = ref()
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })
const pwdRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, max: 64, message: '密码长度需为6-64位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (rule, value, cb) =>
        value === pwdForm.newPassword ? cb() : cb(new Error('两次输入的密码不一致')),
      trigger: 'blur',
    },
  ],
}

function onCommand(cmd) {
  if (cmd === 'logout') {
    store.logout()
    router.push('/login')
  } else if (cmd === 'password') {
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirm = ''
    pwdDialog.value = true
  }
}

async function changePassword() {
  await pwdFormRef.value.validate()
  pwdLoading.value = true
  try {
    await authApi.changePassword({
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword,
    })
    ElMessage.success('密码修改成功')
    pwdDialog.value = false
  } finally {
    pwdLoading.value = false
  }
}
</script>

<style scoped>
.layout {
  height: 100%;
}

.aside {
  background: #fff;
  border-right: 1px solid #ebeef5;
  display: flex;
  flex-direction: column;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 600;
  color: var(--el-color-primary);
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
}

.menu {
  border-right: none;
  flex: 1;
}

.header {
  background: #fff;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-name {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: #303133;
  font-size: 14px;
  outline: none;
}

.main {
  padding: 20px;
  overflow-y: auto;
}
</style>
