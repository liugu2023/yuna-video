import axios from 'axios'
import { ElMessage } from 'element-plus'

const http = axios.create({ baseURL: '/api', timeout: 30000 })

http.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status
    const msg = err.response?.data?.error || err.message || '网络异常'
    ElMessage.error(msg)
    if (status === 401) {
      localStorage.removeItem('token')
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export const authApi = {
  login: (data) => http.post('/auth/login', data),
  me: () => http.get('/auth/me'),
  changePassword: (data) => http.put('/auth/password', data),
}

export const uploadApi = {
  video(file, onProgress) {
    const fd = new FormData()
    fd.append('file', file)
    return http.post('/upload/video', fd, {
      timeout: 0,
      onUploadProgress(e) {
        if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100))
      },
    })
  },
  cover(file) {
    const fd = new FormData()
    fd.append('file', file)
    return http.post('/upload/cover', fd, { timeout: 0 })
  },
}

export const videoApi = {
  list: (params) => http.get('/videos', { params }),
  create: (data) => http.post('/videos', data),
  get: (id) => http.get(`/videos/${id}`),
  update: (id, data) => http.put(`/videos/${id}`, data),
  remove: (id) => http.delete(`/videos/${id}`),
  submit: (id) => http.post(`/videos/${id}/submit`),
  withdraw: (id) => http.post(`/videos/${id}/withdraw`),
}

export const reviewApi = {
  list: (params) => http.get('/review/videos', { params }),
  get: (id) => http.get(`/review/videos/${id}`),
  approve: (id, comment) => http.post(`/review/videos/${id}/approve`, { comment }),
  reject: (id, comment) => http.post(`/review/videos/${id}/reject`, { comment }),
  publish: (id, bvid) => http.post(`/review/videos/${id}/publish`, { bvid }),
  publishConfig: () => http.get('/review/publish-config'),
  autoPublish: (id, data) => http.post(`/review/videos/${id}/auto-publish`, data),
  publishJob: (jobId) => http.get(`/review/publish-jobs/${jobId}`),
}

export const adminApi = {
  users: (params) => http.get('/admin/users', { params }),
  createUser: (data) => http.post('/admin/users', data),
  updateUser: (id, data) => http.put(`/admin/users/${id}`, data),
  resetPassword: (id, password) => http.post(`/admin/users/${id}/reset-password`, { password }),
}

export const statsApi = {
  dashboard: () => http.get('/stats/dashboard'),
}

export const biliApi = {
  status: () => http.get('/bili/status'),
  qrcode: () => http.post('/bili/qrcode'),
  qrcodePoll: (authCode) => http.post('/bili/qrcode/poll', { authCode }),
  check: () => http.post('/bili/check'),
  renew: () => http.post('/bili/renew'),
  unbind: () => http.delete('/bili/binding'),
  dynamicState: () => http.get('/bili/dynamic/state'),
  dynamicHistory: () => http.get('/bili/dynamic/history'),
  postDynamic: (formData) => http.post('/bili/dynamic', formData, { timeout: 0 }),
}

export default http
