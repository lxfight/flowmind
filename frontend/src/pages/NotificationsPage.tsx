import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BellOff, CheckCheck, Info, Loader2 } from 'lucide-react'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '../api/notifications'
import { useUnreadCount } from '../hooks/useUnreadCount'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../utils/cn'
import {
  NOTIFICATION_TYPE_ICONS,
  NOTIFICATION_TYPE_COLORS,
  formatNotificationTime,
} from '../components/layout/NotificationBell'

type Filter = 'all' | 'unread' | 'read'

const PAGE_SIZE = 30

const TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'read', label: '已读' },
]

export default function NotificationsPage() {
  const navigate = useNavigate()
  const { unreadCount, setUnreadCount } = useUnreadCount()
  const [filter, setFilter] = useState<Filter>('all')
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async (page: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const data = await fetchNotifications(page, PAGE_SIZE)
      setNotifications((prev) => (append ? [...prev, ...data.items] : data.items))
      setTotal(data.total)
      setUnreadCount(data.unread_count)
    } catch {
      // ignore
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [setUnreadCount])

  useEffect(() => {
    load(1, false)
  }, [load])

  const filtered = useMemo(() => {
    if (filter === 'unread') return notifications.filter((n) => !n.is_read)
    if (filter === 'read') return notifications.filter((n) => n.is_read)
    return notifications
  }, [filter, notifications])

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
    if (n.link) navigate(n.link)
  }

  const handleReadAll = async () => {
    setMarkingAll(true)
    try {
      await markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch {
      // ignore
    } finally {
      setMarkingAll(false)
    }
  }

  const hasMore = notifications.length < total

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <PageHeader
        title="通知"
        description={unreadCount > 0 ? `你有 ${unreadCount} 条未读通知` : '所有消息都在这里'}
        actions={
          unreadCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReadAll}
              loading={markingAll}
              className="gap-1.5"
            >
              <CheckCheck className="h-4 w-4" />
              全部标为已读
            </Button>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              filter === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            {tab.key === 'unread' && unreadCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={filter === 'unread' ? BellOff : Bell}
          title={filter === 'unread' ? '没有未读通知' : '暂无通知'}
          description={filter === 'unread' ? '所有通知都已读完' : '有新的任务动态时会出现在这里'}
        />
      ) : (
        <div className="surface divide-y divide-border/50 overflow-hidden">
          {filtered.map((n) => {
            const Icon = NOTIFICATION_TYPE_ICONS[n.type] ?? Info
            const color = NOTIFICATION_TYPE_COLORS[n.type] ?? 'text-muted-foreground bg-muted'
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClickItem(n)}
                className={cn(
                  'flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-accent',
                  !n.is_read && 'bg-primary/5'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
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
                    {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                  </span>
                  {n.body && (
                    <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-2">
                      {n.body}
                    </span>
                  )}
                  <span className="mt-1 block text-xs text-muted-foreground/70">
                    {formatNotificationTime(n.created_at)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {!loading && hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(Math.floor(notifications.length / PAGE_SIZE) + 1, true)}
            loading={loadingMore}
          >
            加载更多（{notifications.length}/{total}）
          </Button>
        </div>
      )}
    </div>
  )
}
