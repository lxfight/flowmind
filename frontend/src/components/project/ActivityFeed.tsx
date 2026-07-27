import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
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
const PAGE_CONCURRENCY = 4
const TIMELINE_HEIGHT = 480
const TIMELINE_ITEM_WIDTH = 284
const TIMELINE_PADDING_START = 16
const TIMELINE_PADDING_END = 64
const TIMELINE_OVERSCAN = 3
const INITIAL_RENDER_COUNT = 8
const NODE_Y = [234, 198, 266, 218]

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
    numericDate: `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`,
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
  const reduceMotion = useReducedMotion()
  const [activities, setActivities] = useState<Activity[]>([])
  const [total, setTotal] = useState(0)
  const [loadedCount, setLoadedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [renderRange, setRenderRange] = useState({ start: 0, end: INITIAL_RENDER_COUNT })
  const scrollerRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const timelineWidth = TIMELINE_PADDING_START
    + activities.length * TIMELINE_ITEM_WIDTH
    + TIMELINE_PADDING_END

  useEffect(() => {
    const controller = new AbortController()

    async function loadAllActivities() {
      setLoading(true)
      setError(null)
      setActivities([])
      setTotal(0)
      setLoadedCount(0)
      setRenderRange({ start: 0, end: INITIAL_RENDER_COUNT })

      try {
        const first = await api.get<ActivityPageResponse>(`/projects/${projectId}/activities`, {
          params: { page: 1, page_size: PAGE_SIZE },
          signal: controller.signal,
        })
        const expectedTotal = Number(first.data.total) || 0
        const all = [...first.data.items]
        setTotal(expectedTotal)
        setLoadedCount(all.length)

        const remainingPages = Array.from(
          { length: Math.max(0, Math.ceil(expectedTotal / PAGE_SIZE) - 1) },
          (_, index) => index + 2,
        )
        for (let index = 0; index < remainingPages.length; index += PAGE_CONCURRENCY) {
          const responses = await Promise.all(
            remainingPages.slice(index, index + PAGE_CONCURRENCY).map((page) => (
              api.get<ActivityPageResponse>(`/projects/${projectId}/activities`, {
                params: { page, page_size: PAGE_SIZE },
                signal: controller.signal,
              })
            )),
          )
          responses.forEach((response) => all.push(...response.data.items))
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
    const isAtEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4
    setCanScrollLeft(scroller.scrollLeft > 4)
    setCanScrollRight(!isAtEnd)
    if (activities.length > 0) {
      const firstVisible = Math.floor(
        Math.max(0, scroller.scrollLeft - TIMELINE_PADDING_START) / TIMELINE_ITEM_WIDTH,
      )
      const visibleCount = Math.max(1, Math.ceil(scroller.clientWidth / TIMELINE_ITEM_WIDTH))
      const start = Math.max(0, firstVisible - TIMELINE_OVERSCAN)
      const end = Math.min(
        activities.length,
        firstVisible + visibleCount + TIMELINE_OVERSCAN,
      )
      setRenderRange((previous) => (
        previous.start === start && previous.end === end ? previous : { start, end }
      ))

      const nextIndex = isAtEnd
        ? activities.length - 1
        : Math.round(Math.max(0, scroller.scrollLeft - TIMELINE_PADDING_START) / TIMELINE_ITEM_WIDTH)
      setActiveIndex(Math.min(Math.max(nextIndex, 0), activities.length - 1))
    }
  }, [activities.length])

  const scheduleScrollStateUpdate = useCallback(() => {
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      updateScrollState()
    })
  }, [updateScrollState])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const scroller = scrollerRef.current
      if (scroller && activities.length > 0) {
        scroller.scrollLeft = Math.max(
          0,
          Math.max(timelineWidth, scroller.scrollWidth) - scroller.clientWidth,
        )
      }
      updateScrollState()
    })
    window.addEventListener('resize', updateScrollState)
    return () => {
      cancelAnimationFrame(frame)
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
      window.removeEventListener('resize', updateScrollState)
    }
  }, [activities, timelineWidth, updateScrollState])

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
        <div className="flex min-w-0 items-end gap-3">
          <div className="flex items-baseline gap-1 tnum" aria-label={`第 ${activeIndex + 1} 条，共 ${activities.length} 条动态`}>
            <span className="text-3xl font-bold leading-none text-foreground">
              {String(activeIndex + 1).padStart(2, '0')}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              / {String(activities.length).padStart(2, '0')}
            </span>
          </div>
          <div className="mb-0.5 h-7 w-px bg-border" aria-hidden="true" />
          <div className="mb-0.5 min-w-0 text-[11px] leading-4 text-muted-foreground">
            <span className="block font-semibold text-foreground">项目全量动态</span>
            <span className="block truncate tnum">{formatRange(activities)}</span>
          </div>
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
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-card shadow-sm"
            onClick={() => scrollTimeline(-1)}
            disabled={!canScrollLeft}
            aria-label="向左浏览"
            title="向左浏览"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-card shadow-sm"
            onClick={() => scrollTimeline(1)}
            disabled={!canScrollRight}
            aria-label="向右浏览"
            title="向右浏览"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden">
        <div
          ref={scrollerRef}
          className="scrollbar-thin snap-x snap-proximity overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2"
          onScroll={scheduleScrollStateUpdate}
          aria-label="项目动态时间轴"
        >
          <div
            className="relative h-[480px]"
            style={{ width: timelineWidth }}
          >
            {activities.slice(renderRange.start, renderRange.end).map((activity, offset) => {
              const index = renderRange.start + offset
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
              const nodeY = NODE_Y[index % NODE_Y.length]
              const nextNodeY = NODE_Y[(index + 1) % NODE_Y.length]
              const cardTop = [8, 284, 20, 300][index % 4]
              const connectorPath = above
                ? `M 142 ${cardTop + 168} C 106 ${cardTop + 182}, 178 ${nodeY - 16}, 142 ${nodeY}`
                : `M 142 ${nodeY} C 178 ${nodeY + 20}, 106 ${cardTop - 18}, 142 ${cardTop}`
              const segmentEndX = isLatest ? 148 : TIMELINE_ITEM_WIDTH
              const timelinePath = `M 0 ${nodeY} C ${segmentEndX * 0.32} ${nodeY}, ${segmentEndX * 0.68} ${nextNodeY}, ${segmentEndX} ${nextNodeY}`

              return (
                <article
                  key={activity.id}
                  data-testid="activity-event"
                  className="absolute left-0 top-0 h-[480px] w-[284px] snap-center"
                  style={{
                    transform: `translateX(${TIMELINE_PADDING_START + index * TIMELINE_ITEM_WIDTH}px)`,
                  }}
                >
                  <svg
                    viewBox={`0 0 ${segmentEndX} ${TIMELINE_HEIGHT}`}
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute left-1/2 top-0 h-full overflow-visible"
                    style={{ width: segmentEndX }}
                    aria-hidden="true"
                  >
                    <path
                      d={timelinePath}
                      fill="none"
                      className="stroke-border/45"
                      strokeWidth="8"
                      strokeLinecap="round"
                    />
                    <motion.path
                      d={timelinePath}
                      fill="none"
                      className="stroke-primary/55"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.7, delay: Math.min(index, 10) * 0.035, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </svg>

                  <svg
                    viewBox={`0 0 ${TIMELINE_ITEM_WIDTH} ${TIMELINE_HEIGHT}`}
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-0 h-full w-full text-border"
                    aria-hidden="true"
                  >
                    <motion.path
                      d={connectorPath}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray="3 5"
                      strokeLinecap="round"
                      initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.55, delay: Math.min(index, 10) * 0.035 + 0.12 }}
                    />
                  </svg>

                  <motion.div
                    className={cn(
                      'absolute left-3 right-3 z-10 h-[168px] overflow-hidden rounded-md bg-card/90 p-4 backdrop-blur-sm ring-1 transition-shadow duration-300 dark:ring-white/[0.06]',
                      index === activeIndex ? 'shadow-lg ring-black/[0.08]' : 'shadow-card ring-black/[0.035]',
                      isLatest && 'ring-primary/30',
                    )}
                    style={{ top: cardTop }}
                    initial={reduceMotion ? false : { opacity: 0, y: above ? -18 : 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={reduceMotion ? undefined : { y: -6, rotate: above ? -0.35 : 0.35 }}
                    transition={{ duration: 0.48, delay: Math.min(index, 8) * 0.04, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <span className="pointer-events-none absolute bottom-1 right-2 text-[42px] font-bold leading-none text-foreground/[0.035] tnum" aria-hidden="true">
                      {time.numericDate}
                    </span>

                    <div className="relative z-10 flex items-center justify-between gap-2">
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold', action.className)}>
                        <ActionIcon className="h-3.5 w-3.5" />
                        {action.label}
                      </span>
                      <span className="flex items-center gap-2 text-[10px] font-semibold text-muted-foreground tnum">
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <span className="inline-flex items-center gap-1 text-[11px] font-normal">
                          <TargetIcon className="h-3.5 w-3.5" />
                          {target.label}
                        </span>
                      </span>
                    </div>

                    <p className="relative z-10 mt-2 line-clamp-3 min-h-[3.75rem] text-sm font-semibold leading-5 text-foreground" title={activity.summary}>
                      {activity.summary}
                    </p>

                    <div className="relative z-10 mt-2 flex items-center justify-between gap-3 pt-0.5">
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
                  </motion.div>

                  <motion.div
                    className={cn(
                      'absolute left-1/2 z-10 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-background shadow-sm',
                      action.markerClassName,
                      isLatest && 'ring-4 ring-primary/15',
                    )}
                    style={{ top: nodeY - 10 }}
                    initial={reduceMotion ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 24, delay: Math.min(index, 10) * 0.035 + 0.18 }}
                    aria-hidden="true"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
                  </motion.div>
                </article>
              )
            })}

            <div
              className="absolute top-0 h-[480px] w-16"
              style={{ left: TIMELINE_PADDING_START + activities.length * TIMELINE_ITEM_WIDTH }}
              aria-hidden="true"
            >
              <ArrowRight
                className="absolute left-1 h-4 w-4 text-primary/50"
                style={{ top: NODE_Y[activities.length % NODE_Y.length] - 8 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
