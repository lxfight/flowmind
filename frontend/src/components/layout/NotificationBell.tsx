import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Info } from 'lucide-react'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '../../api/notifications'
import { useUnreadCount } from '../../hooks/useUnreadCount'
import {
  NOTIFICATION_TYPE_ICONS,
  NOTIFICATION_TYPE_COLORS,
  formatNotificationTime,
} from './notificationDisplay'
import { cn } from '../../utils/cn'

export function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { unreadCount, setUnreadCount } = useUnreadCount()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchNotifications(1, 50)
      setNotifications(data.items)
      setUnreadCount(data.unread_count)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [setUnreadCount])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) loadList()
  }

  const handleClickItem = async (n: AppNotification) => {
    if (!n.is_read) {
      try {
        await markNotificationRead(n.id)
        setNotifications((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
        )
        setUnreadCount((c) => Math.max(0, c - 1))
      } catch {
        // still navigate even if marking read fails
      }
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  const handleReadAll = async () => {
    try {
      await markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch {
      // ignore
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="通知"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 sm:w-96 rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">通知</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleReadAll}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <CheckCheck className="h-3.5 w-3.5" /> 全部已读
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">加载中...</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无通知</div>
            ) : (
              notifications.map((n) => {
                const Icon = NOTIFICATION_TYPE_ICONS[n.type] ?? Info
                const color = NOTIFICATION_TYPE_COLORS[n.type] ?? 'text-muted-foreground bg-muted'
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleClickItem(n)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-accent',
                      !n.is_read && 'bg-primary/5'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        color
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'truncate text-sm',
                            n.is_read ? 'text-foreground/80' : 'font-medium text-foreground'
                          )}
                        >
                          {n.title}
                        </span>
                        {!n.is_read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                        )}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-muted-foreground/70">
                        {formatNotificationTime(n.created_at)}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-border px-4 py-2">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-xs text-primary transition-colors hover:underline"
            >
              查看全部通知
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
