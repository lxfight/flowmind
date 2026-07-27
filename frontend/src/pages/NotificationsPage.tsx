import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowUpRight,
  Bell,
  BellOff,
  CalendarDays,
  Check,
  CheckCheck,
  Circle,
  Inbox,
  Info,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '../api/notifications'
import { useUnreadCount } from '../hooks/useUnreadCount'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../utils/cn'
import {
  NOTIFICATION_TYPE_ICONS,
  NOTIFICATION_TYPE_COLORS,
  formatNotificationTime,
} from '../components/layout/notificationDisplay'

type Filter = 'all' | 'unread' | 'read'

interface NotificationGroup {
  key: string
  label: string
  items: AppNotification[]
}

const PAGE_SIZE = 30

const TABS = [
  { key: 'all' as const, label: '全部', icon: Inbox },
  { key: 'unread' as const, label: '未读', icon: Circle },
  { key: 'read' as const, label: '已读', icon: Check },
]

function dayKey(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间未知'

  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDifference = Math.round((startOfToday - startOfDate) / 86_400_000)

  if (dayDifference === 0) return '今天'
  if (dayDifference === 1) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

function groupNotifications(items: AppNotification[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>()
  items.forEach((item) => {
    const key = dayKey(item.created_at)
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { key, label: dayLabel(item.created_at), items: [item] })
  })
  return Array.from(groups.values())
}

export default function NotificationsPage() {
  const navigate = useNavigate()
  const { unreadCount, setUnreadCount } = useUnreadCount()
  const [filter, setFilter] = useState<Filter>('all')
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async (page: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchNotifications(page, PAGE_SIZE)
      setNotifications((prev) => (append ? [...prev, ...data.items] : data.items))
      setTotal(data.total)
      setUnreadCount(data.unread_count)
    } catch {
      setLoadError('通知加载失败，请检查网络后重试')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [setUnreadCount])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: async loader updates state after await
    load(1, false)
  }, [load])

  const filtered = useMemo(() => {
    if (filter === 'unread') return notifications.filter((notification) => !notification.is_read)
    if (filter === 'read') return notifications.filter((notification) => notification.is_read)
    return notifications
  }, [filter, notifications])

  const groups = useMemo(() => groupNotifications(filtered), [filtered])
  const hasMore = notifications.length < total
  const visibleReadCount = notifications.filter((notification) => notification.is_read).length

  const handleClickItem = async (notification: AppNotification) => {
    if (!notification.is_read) {
      try {
        await markNotificationRead(notification.id)
        setNotifications((prev) =>
          prev.map((item) => (item.id === notification.id ? { ...item, is_read: true } : item))
        )
        setUnreadCount((count) => Math.max(0, count - 1))
      } catch {
        // Navigation is more important than the acknowledgement request.
      }
    }
    if (notification.link) navigate(notification.link)
  }

  const handleReadAll = async () => {
    setMarkingAll(true)
    try {
      await markAllNotificationsRead()
      setNotifications((prev) => prev.map((notification) => ({ ...notification, is_read: true })))
      setUnreadCount(0)
    } catch {
      // Keep the current unread state when the acknowledgement request fails.
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] pb-12">
      <header className="relative mb-8 overflow-hidden border-b border-border px-1 pb-7 pt-1">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-foreground/15" />
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-primary">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                <Bell className="h-3.5 w-3.5" />
              </span>
              项目信号流
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
              通知中心
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              任务、评论与成员动态按时间汇聚，点击即可抵达对应上下文。
            </p>
          </div>

          <div className="flex items-end gap-6 lg:justify-end">
            <div className="min-w-28">
              <p className="text-[10px] font-semibold text-muted-foreground">未读动态</p>
              <p className="tnum mt-1 text-5xl font-semibold leading-none text-foreground" aria-label={`${unreadCount} 条未读通知`}>
                {String(unreadCount).padStart(2, '0')}
              </p>
            </div>
            <div className="mb-1 hidden border-l border-border pl-6 sm:block">
              <p className="text-[10px] font-semibold text-muted-foreground">当前已载入</p>
              <p className="tnum mt-1 text-lg font-semibold text-foreground">
                {notifications.length}<span className="ml-1 text-xs font-normal text-muted-foreground">/ {total}</span>
              </p>
              <p className="tnum mt-1 text-[10px] text-muted-foreground">其中 {visibleReadCount} 条已读</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted p-1" aria-label="通知筛选">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const selected = filter === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                aria-pressed={selected}
                className={cn(
                  'relative flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-all duration-200',
                  selected
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                {tab.key === 'unread' && unreadCount > 0 && (
                  <span className="tnum ml-0.5 text-[10px] text-primary">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
              </button>
            )
          })}
        </div>

        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReadAll}
            loading={markingAll}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <CheckCheck className="h-4 w-4" />
            全部标为已读
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center border-y border-border text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在接收通知
        </div>
      ) : loadError ? (
        <div className="flex min-h-64 flex-col items-center justify-center border-y border-border text-center">
          <RefreshCw className="mb-3 h-6 w-6 text-danger" />
          <p className="text-sm font-medium text-foreground">{loadError}</p>
          <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => load(1, false)}>
            <RefreshCw className="h-3.5 w-3.5" />
            重新加载
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={filter === 'unread' ? BellOff : Bell}
          title={filter === 'unread' ? '没有未读通知' : '暂无通知'}
          description={filter === 'unread' ? '当前动态均已处理' : '新的项目动态会在这里汇聚'}
        />
      ) : (
        <div className="space-y-10" aria-label="通知时间线">
          {groups.map((group, groupIndex) => (
            <motion.section
              key={group.key}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(groupIndex * 0.06, 0.18), ease: [0.16, 1, 0.3, 1] }}
              aria-labelledby={`notification-group-${group.key}`}
              className="grid gap-4 md:grid-cols-[7rem_minmax(0,1fr)] md:gap-8"
            >
              <div className="md:pt-4">
                <h2
                  id={`notification-group-${group.key}`}
                  className="flex items-center gap-2 text-xs font-semibold text-muted-foreground md:sticky md:top-6"
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {group.label}
                </h2>
              </div>

              <div className="border-t border-foreground/15">
                {group.items.map((notification, itemIndex) => {
                  const Icon = NOTIFICATION_TYPE_ICONS[notification.type] ?? Info
                  const color = NOTIFICATION_TYPE_COLORS[notification.type] ?? 'text-muted-foreground bg-muted'
                  return (
                    <motion.button
                      key={notification.id}
                      type="button"
                      onClick={() => handleClickItem(notification)}
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.35, delay: Math.min((groupIndex * 3 + itemIndex) * 0.035, 0.25), ease: [0.16, 1, 0.3, 1] }}
                      className={cn(
                        'group relative grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-3 border-b border-border/70 py-4 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[3rem_minmax(0,1fr)_8rem_2.5rem] sm:gap-4 sm:py-5',
                        'hover:bg-muted/25',
                        !notification.is_read && 'before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
                      )}
                    >
                      <span className={cn('flex h-10 w-10 items-center justify-center rounded-md transition-transform duration-300 group-hover:-translate-y-0.5', color)}>
                        <Icon className="h-4 w-4" />
                      </span>

                      <span className="min-w-0 pt-0.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={cn('truncate text-sm text-foreground', !notification.is_read && 'font-semibold')}>
                            {notification.title}
                          </span>
                          {!notification.is_read && (
                            <span className="h-1.5 w-1.5 flex-none rounded-full bg-primary" aria-label="未读" />
                          )}
                        </span>
                        {notification.body && (
                          <span className="mt-1 block line-clamp-2 max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm">
                            {notification.body}
                          </span>
                        )}
                        <span className="tnum mt-2 block text-[10px] text-muted-foreground sm:hidden">
                          {formatNotificationTime(notification.created_at)}
                        </span>
                      </span>

                      <span className="tnum hidden pt-1 text-right text-[10px] text-muted-foreground sm:block">
                        {formatNotificationTime(notification.created_at)}
                      </span>

                      <span className="flex h-8 w-8 items-center justify-center self-center text-muted-foreground transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-foreground">
                        {notification.link ? <ArrowUpRight className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      </span>
                    </motion.button>
                  )
                })}
              </div>
            </motion.section>
          ))}
        </div>
      )}

      {!loading && !loadError && hasMore && (
        <div className="mt-10 flex justify-center border-t border-border pt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(Math.floor(notifications.length / PAGE_SIZE) + 1, true)}
            loading={loadingMore}
            className="gap-1.5"
          >
            <ArrowDown className="h-4 w-4" />
            加载更多
            <span className="tnum text-muted-foreground">{notifications.length}/{total}</span>
          </Button>
        </div>
      )}
    </div>
  )
}
