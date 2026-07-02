<template>
  <div class="login-page">
    <el-card class="login-card">
      <div class="brand">
        <el-icon :size="34"><VideoPlay /></el-icon>
        <h2>协会投稿审核平台</h2>
        <p class="text-muted">B站视频上传 · 审核 · 发布一站式管理</p>
      </div>

      <el-form ref="loginRef" :model="loginForm" :rules="loginRules" size="large">
        <el-form-item prop="username">
          <el-input v-model="loginForm.username" placeholder="用户名" :prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="loginForm.password"
            type="password"
            placeholder="密码"
            show-password
            :prefix-icon="Lock"
            @keyup.enter="doLogin"
          />
        </el-form-item>
        <el-button type="primary" size="large" class="submit-btn" :loading="loading" @click="doLogin">
          登 录
        </el-button>
      </el-form>
      <p class="text-muted register-hint">账号由管理员统一创建，如需开通请联系协会管理员</p>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useUserStore } from '../stores/user'

const router = useRouter()
const store = useUserStore()

const loading = ref(false)

const loginRef = ref()
const loginForm = reactive({ username: '', password: '' })
const loginRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function doLogin() {
  await loginRef.value.validate()
  loading.value = true
  try {
    await store.login({ username: loginForm.username, password: loginForm.password })
    ElMessage.success(`欢迎回来，${store.user.nickname}`)
    router.push('/')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(120deg, #fb7299 0%, #fc9db7 45%, #23ade5 100%);
}

.login-card {
  width: 400px;
  border-radius: 12px;
  padding: 8px 8px 16px;
}

.brand {
  text-align: center;
  color: var(--el-color-primary);
  margin-bottom: 16px;
}

.brand h2 {
  margin: 6px 0 4px;
  color: #303133;
}

.brand p {
  margin: 0;
}

.submit-btn {
  width: 100%;
  margin-top: 4px;
}

.register-hint {
  text-align: center;
  margin: 14px 0 0;
  font-size: 12px;
}
</style>
