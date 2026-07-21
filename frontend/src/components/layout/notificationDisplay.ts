import {
  ClipboardList,
  MessageSquare,
  AtSign,
  UserCheck,
  UserX,
  UserPlus,
  Info,
} from 'lucide-react'

export const NOTIFICATION_TYPE_ICONS: Record<string, typeof Info> = {
  task_assigned: ClipboardList,
  comment: MessageSquare,
  mention: AtSign,
  user_approved: UserCheck,
  user_rejected: UserX,
  member_added: UserPlus,
}

export const NOTIFICATION_TYPE_COLORS: Record<string, string> = {
  task_assigned: 'text-blue-500 bg-blue-500/10',
  comment: 'text-green-500 bg-green-500/10',
  mention: 'text-purple-500 bg-purple-500/10',
  user_approved: 'text-emerald-500 bg-emerald-500/10',
  user_rejected: 'text-red-500 bg-red-500/10',
  member_added: 'text-amber-500 bg-amber-500/10',
}

export function formatNotificationTime(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString('zh-CN')
}

