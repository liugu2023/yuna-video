<template>
  <div class="login-page">
    <el-card class="login-card">
      <div class="brand">
        <el-icon :size="34"><VideoPlay /></el-icon>
        <h2>协会投稿审核平台</h2>
        <p class="text-muted">B站视频上传 · 审核 · 发布一站式管理</p>
      </div>

      <el-tabs v-model="tab" stretch>
        <el-tab-pane label="登录" name="login">
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
        </el-tab-pane>

        <el-tab-pane label="注册" name="register">
          <el-form ref="regRef" :model="regForm" :rules="regRules" size="large">
            <el-form-item prop="username">
              <el-input v-model="regForm.username" placeholder="用户名（3-20位字母/数字/下划线）" :prefix-icon="User" />
            </el-form-item>
            <el-form-item prop="nickname">
              <el-input v-model="regForm.nickname" placeholder="昵称（协会内展示名）" :prefix-icon="Postcard" />
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="regForm.password" type="password" placeholder="密码（至少6位）" show-password :prefix-icon="Lock" />
            </el-form-item>
            <el-form-item prop="confirm">
              <el-input v-model="regForm.confirm" type="password" placeholder="确认密码" show-password :prefix-icon="Lock" />
            </el-form-item>
            <el-form-item v-if="inviteRequired" prop="inviteCode">
              <el-input v-model="regForm.inviteCode" placeholder="邀请码" :prefix-icon="Key" />
            </el-form-item>
            <el-button type="primary" size="large" class="submit-btn" :loading="loading" @click="doRegister">
              注册并登录
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock, Postcard, Key } from '@element-plus/icons-vue'
import { authApi } from '../api'
import { useUserStore } from '../stores/user'

const router = useRouter()
const store = useUserStore()

const tab = ref('login')
const loading = ref(false)
const inviteRequired = ref(false)

const loginRef = ref()
const loginForm = reactive({ username: '', password: '' })
const loginRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

const regRef = ref()
const regForm = reactive({ username: '', nickname: '', password: '', confirm: '', inviteCode: '' })
const regRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9_]{3,20}$/, message: '3-20位字母、数字或下划线', trigger: 'blur' },
  ],
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, max: 64, message: '密码长度需为6-64位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (rule, value, cb) => (value === regForm.password ? cb() : cb(new Error('两次输入的密码不一致'))),
      trigger: 'blur',
    },
  ],
  inviteCode: [{ required: true, message: '请输入邀请码', trigger: 'blur' }],
}

onMounted(async () => {
  try {
    const cfg = await authApi.config()
    inviteRequired.value = cfg.inviteRequired
  } catch {
    /* 后端未启动时静默 */
  }
})

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

async function doRegister() {
  await regRef.value.validate()
  loading.value = true
  try {
    const data = await authApi.register({
      username: regForm.username,
      nickname: regForm.nickname,
      password: regForm.password,
      inviteCode: regForm.inviteCode,
    })
    store.applyAuth(data)
    ElMessage.success('注册成功，已自动登录')
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
  margin-bottom: 8px;
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
</style>
