import api from '../utils/api'

export type NotificationType =
  | 'task_assigned'
  | 'comment'
  | 'mention'
  | 'user_approved'
  | 'user_rejected'
  | 'member_added'
  | string

export interface AppNotification {
  id: number
  user_id: number
  type: NotificationType
  title: string
  body: string
  link: string
  is_read: boolean
  created_at: string
}

export interface NotificationListResponse {
  items: AppNotification[]
  unread_count: number
  total: number
  page: number
  page_size: number
}

export async function fetchNotifications(page = 1, pageSize = 20): Promise<NotificationListResponse> {
  const res = await api.get('/notifications', { params: { page, page_size: pageSize } })
  return res.data
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await api.get('/notifications/unread-count')
  return res.data.unread_count as number
}

export async function markNotificationRead(id: number): Promise<AppNotification> {
  const res = await api.post(`/notifications/${id}/read`)
  return res.data
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/notifications/read-all')
}
