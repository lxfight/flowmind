import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Clock3,
  Edit3,
  FileText,
  FolderKanban,
  ListChecks,
  Loader2,
  MessageSquare,
  MoveRight,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users,
} from 'lucide-react'
import api, { errDetail } from '../../utils/api'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { cn } from '../../utils/cn'

interface Activity {
  id: number
  action: string
  target_type: string
  target_id: number
  summary: string
  user_name: string
  created_at: string
}

interface ActivityPageResponse {
  items: Activity[]
  total: number
}

interface Props {
  projectId: number
}

const PAGE_SIZE = 100

const actionPresentation: Record<string, {
  icon: React.ComponentType<{ className?: string }>
  label: string
  className: string
  markerClassName: string
}> = {
  create: {
    icon: Plus,
    label: '创建',
    className: 'bg-success/10 text-success',
    markerClassName: 'bg-success',
  },
  update: {
    icon: Edit3,
    label: '更新',
    className: 'bg-info/10 text-info',
    markerClassName: 'bg-info',
  },
  delete: {
    icon: Trash2,
    label: '删除',
    className: 'bg-danger/10 text-danger',
    markerClassName: 'bg-danger',
  },
  move: {
    icon: MoveRight,
    label: '流转',
    className: 'bg-primary/10 text-primary',
    markerClassName: 'bg-primary',
  },
  comment: {
    icon: MessageSquare,
    label: '评论',
    className: 'bg-warning/10 text-warning',
    markerClassName: 'bg-warning',
  },
  undo: {
    icon: RotateCcw,
    label: '撤销',
    className: 'bg-muted text-muted-foreground',
    markerClassName: 'bg-muted-foreground',
  },
}

const targetPresentation: Record<string, {
  icon: React.ComponentType<{ className?: string }>
  label: string
}> = {
  task: { icon: FolderKanban, label: '任务' },
  subtask: { icon: ListChecks, label: '子任务' },
  project: { icon: FileText, label: '项目' },
  doc: { icon: BookOpen, label: '文档' },
  member: { icon: Users, label: '成员' },
  status: { icon: MoveRight, label: '状态' },
  agent_batch: { icon: Bot, label: '智能助手' },
}

function formatEventTime(value: string) {
  const date = new Date(value)
  return {
    date: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
    time: date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    full: date.toLocaleString('zh-CN', { hour12: false }),
  }
}

function formatRange(activities: Activity[]) {
  if (activities.length === 0) return ''
  const format = (value: string) => new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  return `${format(activities[0].created_at)} - ${format(activities[activities.length - 1].created_at)}`
}

function initials(name: string) {
  const normalized = name.trim()
  if (!normalized) return '?'
  return normalized.slice(0, 2).toUpperCase()
}

export function ActivityFeed({ projectId }: Props) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [total, setTotal] = useState(0)
  const [loadedCount, setLoadedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadAllActivities() {
      setLoading(true)
      setError(null)
      setActivities([])
      setTotal(0)
      setLoadedCount(0)

      try {
        const first = await api.get<ActivityPageResponse>(`/projects/${projectId}/activities`, {
          params: { page: 1, page_size: PAGE_SIZE },
          signal: controller.signal,
        })
        const expectedTotal = Number(first.data.total) || 0
        const all = [...first.data.items]
        setTotal(expectedTotal)
        setLoadedCount(all.length)

        const pageCount = Math.ceil(expectedTotal / PAGE_SIZE)
        for (let page = 2; page <= pageCount; page += 1) {
          const response = await api.get<ActivityPageResponse>(`/projects/${projectId}/activities`, {
            params: { page, page_size: PAGE_SIZE },
            signal: controller.signal,
          })
          all.push(...response.data.items)
          setLoadedCount(Math.min(all.length, expectedTotal))
        }

        if (controller.signal.aborted) return
        const unique = Array.from(new Map(all.map((activity) => [activity.id, activity])).values())
        unique.sort((left, right) => {
          const timeDifference = new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
          return timeDifference || left.id - right.id
        })
        setActivities(unique)
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          setError(errDetail(err, '加载项目动态失败'))
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadAllActivities()
    return () => controller.abort()
  }, [projectId, reloadKey])

  const updateScrollState = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    setCanScrollLeft(scroller.scrollLeft > 4)
    setCanScrollRight(scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(updateScrollState)
    window.addEventListener('resize', updateScrollState)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [activities, updateScrollState])

  const scrollTimeline = (direction: -1 | 1) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollBy({
      left: direction * Math.max(280, scroller.clientWidth * 0.72),
      behavior: 'smooth',
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-sm border border-border bg-card/50">
        <div className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">
            {total > PAGE_SIZE ? `正在载入全部动态 ${loadedCount}/${total}` : '正在整理项目时间轴'}
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-sm border border-border bg-card p-10 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-danger" />
        <p className="mb-4 text-sm text-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setReloadKey((value) => value + 1)} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          重试
        </Button>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="暂无活动记录"
        description="项目中的任务操作将显示在这里"
      />
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border bg-card px-2.5 py-1 font-medium text-foreground tnum">
            {activities.length} 条动态
          </span>
          <span className="tnum">{formatRange(activities)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setReloadKey((value) => value + 1)}
            aria-label="刷新动态"
            title="刷新动态"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <span className="mx-1 h-4 w-px bg-border" />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => scrollTimeline(-1)}
            disabled={!canScrollLeft}
            aria-label="向左浏览"
            title="向左浏览"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => scrollTimeline(1)}
            disabled={!canScrollRight}
            aria-label="向右浏览"
            title="向右浏览"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-sm border border-border bg-card/50">
        <div
          ref={scrollerRef}
          className="scrollbar-thin snap-x snap-proximity overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-smooth"
          onScroll={updateScrollState}
          aria-label="项目动态时间轴"
        >
          <div className="relative flex min-w-max px-8 sm:px-10">
            <div className="absolute left-8 right-8 top-[236px] h-px bg-border sm:left-10 sm:right-10" aria-hidden="true" />

            {activities.map((activity, index) => {
              const action = actionPresentation[activity.action] ?? {
                icon: Clock3,
                label: '动态',
                className: 'bg-muted text-muted-foreground',
                markerClassName: 'bg-muted-foreground',
              }
              const target = targetPresentation[activity.target_type] ?? {
                icon: FileText,
                label: activity.target_type || '记录',
              }
              const ActionIcon = action.icon
              const TargetIcon = target.icon
              const time = formatEventTime(activity.created_at)
              const above = index % 2 === 0
              const isLatest = index === activities.length - 1

              return (
                <article
                  key={activity.id}
                  data-testid="activity-event"
                  className="relative h-[472px] w-[252px] flex-none snap-center sm:w-[292px]"
                >
                  <div
                    className={cn(
                      'absolute left-3 right-3 h-[168px] rounded-sm border bg-card p-4 shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md',
                      above ? 'top-5' : 'top-[284px]',
                      isLatest && 'border-primary/40',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold', action.className)}>
                        <ActionIcon className="h-3.5 w-3.5" />
                        {action.label}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <TargetIcon className="h-3.5 w-3.5" />
                        {target.label}
                      </span>
                    </div>

                    <p className="mt-3 line-clamp-3 min-h-[3.75rem] text-sm font-medium leading-5 text-foreground" title={activity.summary}>
                      {activity.summary}
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-2.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                          {initials(activity.user_name)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{activity.user_name || '系统'}</span>
                      </span>
                      <time className="flex-none text-right text-[11px] text-muted-foreground tnum" dateTime={activity.created_at} title={time.full}>
                        <span className="block font-medium text-foreground">{time.date}</span>
                        {time.time}
                      </time>
                    </div>
                  </div>

                  <div
                    className={cn(
                      'absolute left-1/2 w-px -translate-x-1/2 bg-border',
                      above ? 'top-[188px] h-12' : 'top-[236px] h-12',
                    )}
                    aria-hidden="true"
                  />
                  <div
                    className={cn(
                      'absolute left-1/2 top-[226px] z-10 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-card shadow-sm',
                      action.markerClassName,
                      isLatest && 'ring-4 ring-primary/15',
                    )}
                    aria-hidden="true"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
                  </div>
                </article>
              )
            })}

            <div className="relative h-[472px] w-12 flex-none" aria-hidden="true">
              <ArrowRight className="absolute left-1 top-[228px] h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
