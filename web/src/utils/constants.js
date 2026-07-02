// B站常用分区
export const CATEGORIES = [
  '动画',
  '音乐',
  '舞蹈',
  '游戏',
  '知识',
  '科技数码',
  '运动',
  '汽车',
  '生活',
  '美食',
  '动物圈',
  '鬼畜',
  '时尚',
  '资讯',
  '娱乐',
  '影视',
  '纪录片',
  '虚拟UP主',
  '其他',
]

export const STATUS_MAP = {
  draft: { label: '草稿', type: 'info' },
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  published: { label: '已发布', type: 'primary' },
}

export const ACTION_MAP = {
  submit: { label: '提交审核', type: 'warning' },
  withdraw: { label: '撤回', type: 'info' },
  approve: { label: '审核通过', type: 'success' },
  reject: { label: '驳回', type: 'danger' },
  publish: { label: '发布', type: 'primary' },
}

export const ROLE_MAP = {
  member: { label: '成员', type: 'info' },
  reviewer: { label: '审核员', type: 'warning' },
  admin: { label: '管理员', type: 'danger' },
}

// biliup 自动投稿常用分区ID（tid），可在下拉框直接输入其他数字
export const TID_OPTIONS = [
  { label: '生活 · 日常', value: 21 },
  { label: '动画 · MAD/AMV', value: 24 },
  { label: '音乐 · 原创音乐', value: 28 },
  { label: '音乐 · 翻唱', value: 31 },
  { label: '舞蹈 · 宅舞', value: 20 },
  { label: '游戏 · 单机游戏', value: 17 },
  { label: '游戏 · 手机游戏', value: 172 },
  { label: '知识 · 科学科普', value: 201 },
  { label: '鬼畜 · 鬼畜调教', value: 22 },
  { label: '影视 · 影视剪辑', value: 183 },
  { label: '娱乐 · 综合', value: 71 },
  { label: '虚拟UP主', value: 371 },
]

export function formatSize(bytes) {
  if (!bytes) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// 浏览器可直接播放的格式，其余提示下载查看
export function isPlayable(videoPath) {
  return /\.(mp4|m4v|webm|mov)$/i.test(videoPath || '')
}
