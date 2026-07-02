import { defineStore } from 'pinia'
import { authApi } from '../api'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: null,
  }),
  getters: {
    isReviewer: (s) => ['reviewer', 'admin'].includes(s.user?.role),
    isAdmin: (s) => s.user?.role === 'admin',
  },
  actions: {
    applyAuth({ token, user }) {
      this.token = token
      this.user = user
      localStorage.setItem('token', token)
    },
    async login(payload) {
      const data = await authApi.login(payload)
      this.applyAuth(data)
    },
    async fetchMe() {
      this.user = await authApi.me()
    },
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem('token')
    },
  },
})
