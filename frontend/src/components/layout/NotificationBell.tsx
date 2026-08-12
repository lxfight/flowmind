import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Bell, BellOff, CheckCheck, Info, Loader2 } from 'lucide-react'
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

const BELL_PAGE_SIZE = 30

export function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { unreadCount, setUnreadCount } = useUnreadCount()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const pageRef = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
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
    pageRef.current = 1
    try {
      const data = await fetchNotifications(1, BELL_PAGE_SIZE)
      setNotifications(data.items)
      setHasMore(data.items.length < data.total)
      setUnreadCount(data.unread_count)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [setUnreadCount])

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return
    setLoadingMore(true)
    const next = pageRef.current + 1
    try {
      const data = await fetchNotifications(next, BELL_PAGE_SIZE)
      setNotifications((prev) => {
        const seen = new Set(prev.map((n) => n.id))
        return [...prev, ...data.items.filter((n) => !seen.has(n.id))]
      })
      setHasMore(data.items.length < data.total)
      pageRef.current = next
    } catch {
      // ignore; the next scroll attempt will retry
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loading, loadingMore])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      void loadMore()
    }
  }

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

          <div ref={scrollRef} onScroll={handleScroll} className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center px-4 py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在接收通知
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-8 text-center text-sm text-muted-foreground">
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-[8px] bg-muted">
                  <BellOff className="h-4 w-4" />
                </span>
                暂无通知
              </div>
            ) : (
              <>
                {notifications.map((n) => {
                  const Icon = NOTIFICATION_TYPE_ICONS[n.type] ?? Info
                  const color = NOTIFICATION_TYPE_COLORS[n.type] ?? 'text-muted-foreground bg-muted'
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleClickItem(n)}
                      className={cn(
                        'group flex w-full items-start gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-accent',
                        !n.is_read && 'bg-primary/5'
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]',
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
                      <ArrowUpRight className="mt-2 h-3.5 w-3.5 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </button>
                  )
                })}
                {hasMore && (
                  <div className="flex items-center justify-center px-4 py-3">
                    {loadingMore ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-xs text-muted-foreground">继续滚动加载更多</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border-t border-border px-4 py-2">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 text-center text-xs text-primary transition-colors hover:underline"
            >
              查看全部通知
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
