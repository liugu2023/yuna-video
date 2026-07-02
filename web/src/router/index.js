import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../stores/user'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/Login.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/',
    component: () => import('../layout/MainLayout.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '工作台' } },
      { path: 'videos', name: 'my-videos', component: () => import('../views/MyVideos.vue'), meta: { title: '我的稿件' } },
      { path: 'videos/new', name: 'video-new', component: () => import('../views/VideoForm.vue'), meta: { title: '新建投稿' } },
      { path: 'videos/:id/edit', name: 'video-edit', component: () => import('../views/VideoForm.vue'), meta: { title: '编辑稿件' } },
      { path: 'videos/:id', name: 'video-detail', component: () => import('../views/VideoDetail.vue'), meta: { title: '稿件详情' } },
      {
        path: 'review',
        name: 'review-queue',
        component: () => import('../views/ReviewQueue.vue'),
        meta: { title: '审核中心', roles: ['reviewer', 'admin'] },
      },
      {
        path: 'review/:id',
        name: 'review-detail',
        component: () => import('../views/ReviewDetail.vue'),
        meta: { title: '稿件审核', roles: ['reviewer', 'admin'] },
      },
      {
        path: 'admin/users',
        name: 'admin-users',
        component: () => import('../views/AdminUsers.vue'),
        meta: { title: '成员管理', roles: ['admin'] },
      },
      {
        path: 'admin/bilibili',
        name: 'admin-bilibili',
        component: () => import('../views/AdminBilibili.vue'),
        meta: { title: 'B站账号', roles: ['admin'] },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const store = useUserStore()

  if (to.path === '/login') {
    return store.token ? '/' : true
  }
  if (!store.token) return '/login'

  if (!store.user) {
    try {
      await store.fetchMe()
    } catch {
      store.logout()
      return '/login'
    }
  }

  if (to.meta.roles && !to.meta.roles.includes(store.user.role)) {
    ElMessage.warning('没有访问该页面的权限')
    return '/'
  }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 投稿审核平台` : '投稿审核平台'
})

export default router
