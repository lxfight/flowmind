import axios from 'axios'
import { useAuthStore } from '../stores/authStore'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // FormData 上传必须移除默认的 application/json，让浏览器自动带 multipart
  // 边界；否则 axios 会把 FormData 序列化为 JSON，后端因缺少表单字段返回 422
  if (config.data instanceof FormData) {
    config.headers.delete('Content-Type')
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
    }
    return Promise.reject(err)
  }
)

/**
 * 将 FastAPI 错误 detail 转为可安全渲染的字符串。
 * detail 通常是字符串，但 422 校验失败时是 [{type, loc, msg, input}] 数组，
 * 直接渲染会导致 React 崩溃（Objects are not valid as a React child）。
 */
export function detailToText(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>
          const msg = typeof rec.msg === 'string' ? rec.msg : ''
          const loc = Array.isArray(rec.loc) ? rec.loc : []
          const field = loc.length > 0 ? String(loc[loc.length - 1]) : ''
          if (msg && field && field !== 'body') return `${field}: ${msg}`
          if (msg) return msg
          return JSON.stringify(rec)
        }
        return String(item)
      })
      .join('；')
  }
  if (detail && typeof detail === 'object') {
    try {
      return JSON.stringify(detail)
    } catch {
      // fall through to fallback
    }
  }
  return fallback
}

/** 从 axios 错误中安全提取错误文案，永远返回字符串（422 数组也能处理） */
export function errDetail(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const text = detailToText(err.response?.data?.detail, '')
    if (text) return text
  }
  return fallback
}

export default api
