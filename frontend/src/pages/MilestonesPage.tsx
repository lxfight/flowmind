import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  Edit3,
  Flag,
  History,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  UserRound,
  XCircle,
} from 'lucide-react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  createMilestone,
  deleteMilestone,
  listMilestones,
  listMilestoneTimeline,
  updateMilestone,
} from '../api/milestones'
import { MilestoneDialog } from '../components/milestones/MilestoneDialog'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { confirmAction } from '../components/ui/confirmAction'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../components/ui/DropdownMenu'
import { useProjectRole } from '../hooks/useProjectRole'
import { useProjectSocket } from '../hooks/useProjectSocket'
import { useAuthStore } from '../stores/authStore'
import api, { errDetail } from '../utils/api'
import { cn } from '../utils/cn'
import {
  buildMilestoneTimelineLayout,
  TIMELINE_CANVAS_HEIGHT,
} from '../utils/milestoneTimeline'
import type {
  MemberOption,
  Milestone,
  MilestoneHealth,
  MilestoneInput,
  TaskSummary,
} from '../types'
import './MilestonesPage.css'

type ViewFilter = 'open' | 'completed' | 'all'

const healthConfig: Record<
  MilestoneHealth,
  { label: string; className: string; icon: typeof CircleDot }
> = {
  on_track: { label: '按计划', className: 'is-on-track', icon: CircleDot },
  at_risk: { label: '有风险', className: 'is-at-risk', icon: AlertCircle },
  overdue: { label: '已逾期', className: 'is-overdue', icon: Clock3 },
  completed: { label: '已完成', className: 'is-completed', icon: CheckCircle2 },
  cancelled: { label: '已取消', className: 'is-cancelled', icon: XCircle },
}

function targetCopy(targetDate: string, health: MilestoneHealth) {
  if (health === 'completed') return '已完成'
  if (health === 'cancelled') return '已取消'
  const days = differenceInCalendarDays(parseISO(targetDate), new Date())
  if (days === 0) return '今天到期'
  if (days < 0) return `逾期 ${Math.abs(days)} 天`
  return `还有 ${days} 天`
}

function timelineGapCopy(days: number) {
  if (days <= 0) return '同日'
  return `相隔 ${days} 天`
}

const TIMELINE_PAGE_SIZE = 12

function statusForView(view: ViewFilter) {
  if (view === 'open') return 'open' as const
  if (view === 'completed') return 'archived' as const
  return undefined
}

function milestoneMatchesView(milestone: Milestone, view: ViewFilter) {
  if (view === 'open') return milestone.status === 'open'
  if (view === 'completed') return milestone.status !== 'open'
  return true
}

function mergeMilestones(current: Milestone[], incoming: Milestone[]) {
  const byId = new Map(current.map((milestone) => [milestone.id, milestone]))
  incoming.forEach((milestone) => byId.set(milestone.id, milestone))
  return [...byId.values()].sort((left, right) =>
    left.target_date.localeCompare(right.target_date) || left.id - right.id,
  )
}

async function loadAllTasks(projectId: number): Promise<TaskSummary[]> {
  const first = await api.get(`/projects/${projectId}/tasks`, {
    params: { page: 1, page_size: 100 },
  })
  const firstItems = first.data.items as TaskSummary[]
  const pageCount = Math.ceil(Number(first.data.total || firstItems.length) / 100)
  if (pageCount <= 1) return firstItems
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      api.get(`/projects/${projectId}/tasks`, {
        params: { page: index + 2, page_size: 100 },
      }),
    ),
  )
  return firstItems.concat(rest.flatMap((response) => response.data.items as TaskSummary[]))
}

export default function MilestonesPage() {
  const { projectId: rawProjectId } = useParams()
  const projectId = Number(rawProjectId)
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const role = useProjectRole()
  const isViewer = role === 'viewer'
  const currentUserId = useAuthStore((state) => state.user?.id)
  const anchorDate = useMemo(() => format(new Date(), 'yyyy-MM-dd'), [])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [dialogMilestones, setDialogMilestones] = useState<Milestone[] | null>(null)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [members, setMembers] = useState<MemberOption[]>([])
  const [supportLoading, setSupportLoading] = useState(true)
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [loadingFuture, setLoadingFuture] = useState(false)
  const [loadingPast, setLoadingPast] = useState(false)
  const [hasMoreFuture, setHasMoreFuture] = useState(false)
  const [hasMorePast, setHasMorePast] = useState(false)
  const [historyStarted, setHistoryStarted] = useState(false)
  const [futureCursor, setFutureCursor] = useState<{ date: string; id: number } | null>(null)
  const [pastCursor, setPastCursor] = useState<{ date: string; id: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewFilter>('open')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [saving, setSaving] = useState(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timelineRequest = useRef(0)
  const loadingFutureRef = useRef(false)
  const loadingPastRef = useRef(false)
  const dialogMilestonesLoading = useRef(false)
  const historyStartedRef = useRef(false)
  const pendingScrollShift = useRef(0)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const futureSentinelRef = useRef<HTMLSpanElement>(null)

  const loadSupportData = useCallback(async (showLoading = true) => {
    if (!projectId) return
    if (showLoading) setSupportLoading(true)
    try {
      const [nextTasks, membersResponse] = await Promise.all([
        loadAllTasks(projectId),
        api.get(`/projects/${projectId}/members`),
      ])
      setTasks(nextTasks)
      setMembers(membersResponse.data)
    } catch (requestError) {
      setError(errDetail(requestError, '里程碑工作台加载失败'))
    } finally {
      if (showLoading) setSupportLoading(false)
    }
  }, [projectId])

  const loadInitialTimeline = useCallback(async (showLoading = true) => {
    if (!projectId) return
    const request = ++timelineRequest.current
    if (showLoading) setTimelineLoading(true)
    setError(null)
    loadingFutureRef.current = false
    loadingPastRef.current = false
    historyStartedRef.current = false
    setHistoryStarted(false)
    setPastCursor(null)
    try {
      const page = await listMilestoneTimeline(projectId, {
        anchorDate,
        direction: 'forward',
        limit: TIMELINE_PAGE_SIZE,
        status: statusForView(view),
      })
      if (request !== timelineRequest.current) return
      setMilestones(page.items)
      setHasMoreFuture(page.has_more)
      setHasMorePast(page.has_history)
      setFutureCursor(page.next_cursor_date && page.next_cursor_id
        ? { date: page.next_cursor_date, id: page.next_cursor_id }
        : null)
      setSelectedId((current) =>
        current && page.items.some((item) => item.id === current)
          ? current
          : (page.items[0]?.id ?? null),
      )
      if (timelineScrollRef.current) timelineScrollRef.current.scrollLeft = 0
    } catch (requestError) {
      if (request === timelineRequest.current) {
        setError(errDetail(requestError, '里程碑时间线加载失败'))
      }
    } finally {
      if (showLoading && request === timelineRequest.current) setTimelineLoading(false)
    }
  }, [anchorDate, projectId, view])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount loader owns the support-data state
    void loadSupportData()
  }, [loadSupportData])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- filter changes intentionally reset the paged timeline
    void loadInitialTimeline()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [loadInitialTimeline])

  useProjectSocket(projectId || undefined, (event) => {
    if (!event.type.startsWith('milestone_') && !event.type.startsWith('task_')) return
    if (event.actor_id && event.actor_id === currentUserId) return
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      void loadInitialTimeline(false)
      if (event.type.startsWith('task_')) void loadSupportData(false)
    }, 250)
  })

  const loadFuture = useCallback(async () => {
    if (!projectId || !hasMoreFuture || !futureCursor || loadingFutureRef.current) return
    loadingFutureRef.current = true
    setLoadingFuture(true)
    const request = timelineRequest.current
    try {
      const page = await listMilestoneTimeline(projectId, {
        anchorDate,
        direction: 'forward',
        limit: TIMELINE_PAGE_SIZE,
        status: statusForView(view),
        cursorDate: futureCursor.date,
        cursorId: futureCursor.id,
      })
      if (request !== timelineRequest.current) return
      setMilestones((current) => mergeMilestones(current, page.items))
      setHasMoreFuture(page.has_more)
      setFutureCursor(page.next_cursor_date && page.next_cursor_id
        ? { date: page.next_cursor_date, id: page.next_cursor_id }
        : null)
    } catch (requestError) {
      toast.error(errDetail(requestError, '后续里程碑加载失败'))
    } finally {
      loadingFutureRef.current = false
      setLoadingFuture(false)
    }
  }, [anchorDate, futureCursor, hasMoreFuture, projectId, view])

  const loadPast = useCallback(async () => {
    if (!projectId || !hasMorePast || loadingPastRef.current) return
    loadingPastRef.current = true
    setLoadingPast(true)
    const request = timelineRequest.current
    try {
      const page = await listMilestoneTimeline(projectId, {
        anchorDate,
        direction: 'backward',
        limit: TIMELINE_PAGE_SIZE,
        status: statusForView(view),
        cursorDate: pastCursor?.date,
        cursorId: pastCursor?.id,
      })
      if (request !== timelineRequest.current) return
      setMilestones((current) => {
        const next = mergeMilestones(current, page.items)
        const shift = buildMilestoneTimelineLayout(next, anchorDate).todayX
          - buildMilestoneTimelineLayout(current, anchorDate).todayX
        pendingScrollShift.current += Math.max(shift, 0)
        return next
      })
      setHasMorePast(page.has_more)
      setPastCursor(page.next_cursor_date && page.next_cursor_id
        ? { date: page.next_cursor_date, id: page.next_cursor_id }
        : null)
    } catch (requestError) {
      toast.error(errDetail(requestError, '历史里程碑加载失败'))
    } finally {
      loadingPastRef.current = false
      setLoadingPast(false)
    }
  }, [anchorDate, hasMorePast, pastCursor, projectId, view])

  useLayoutEffect(() => {
    if (!pendingScrollShift.current || !timelineScrollRef.current) return
    timelineScrollRef.current.scrollLeft += pendingScrollShift.current
    pendingScrollShift.current = 0
  }, [milestones])

  useEffect(() => {
    const root = timelineScrollRef.current
    const sentinel = futureSentinelRef.current
    if (!root || !sentinel || !hasMoreFuture) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadFuture()
      },
      { root, rootMargin: '0px 240px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMoreFuture, loadFuture, milestones.length])

  const timelineLayout = useMemo(
    () => buildMilestoneTimelineLayout(milestones, anchorDate),
    [anchorDate, milestones],
  )
  const timelineIntervals = useMemo(() => {
    const points = [{ date: anchorDate, x: timelineLayout.todayX, y: timelineLayout.todayY }]
    timelineLayout.items.forEach(({ milestone, x, y }) => {
      if (!points.some((point) => point.date === milestone.target_date)) {
        points.push({ date: milestone.target_date, x, y })
      }
    })
    points.sort((left, right) => left.date.localeCompare(right.date))
    return points.slice(0, -1).map((point, index) => {
      const next = points[index + 1]
      return {
        days: differenceInCalendarDays(parseISO(next.date), parseISO(point.date)),
        x: point.x + (next.x - point.x) / 2,
        y: point.y + (next.y - point.y) / 2,
      }
    })
  }, [anchorDate, timelineLayout])

  const selected = milestones.find((milestone) => milestone.id === selectedId) ?? milestones[0] ?? null
  const selectedTasks = selected
    ? selected.task_ids
        .map((id) => tasks.find((task) => task.id === id))
        .filter((task): task is TaskSummary => Boolean(task))
    : []
  const atRiskCount = milestones.filter((milestone) =>
    ['at_risk', 'overdue'].includes(milestone.health),
  ).length
  const overallProgress = milestones.length
    ? Math.round(milestones.reduce((sum, milestone) => sum + milestone.progress, 0) / milestones.length)
    : 0

  const hydrateDialogMilestones = useCallback(async () => {
    if (dialogMilestones || dialogMilestonesLoading.current || !projectId) return
    dialogMilestonesLoading.current = true
    try {
      setDialogMilestones(await listMilestones(projectId))
    } catch (requestError) {
      toast.error(errDetail(requestError, '完整里程碑归属加载失败'))
    } finally {
      dialogMilestonesLoading.current = false
    }
  }, [dialogMilestones, projectId])

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
    void hydrateDialogMilestones()
  }

  const openEdit = (milestone: Milestone) => {
    setEditing(milestone)
    setDialogOpen(true)
    void hydrateDialogMilestones()
  }

  const applySavedMilestone = (saved: Milestone) => {
    const visible = milestoneMatchesView(saved, view)
    setMilestones((current) => visible
      ? mergeMilestones(current, [saved])
      : current.filter((item) => item.id !== saved.id))
    setDialogMilestones((current) => current ? mergeMilestones(current, [saved]) : current)
    setSelectedId(visible ? saved.id : null)
  }

  const handleSubmit = async (input: MilestoneInput) => {
    setSaving(true)
    try {
      const saved = editing
        ? await updateMilestone(projectId, editing.id, input)
        : await createMilestone(projectId, input)
      applySavedMilestone(saved)
      setTasks(await loadAllTasks(projectId))
      setDialogOpen(false)
      setEditing(null)
      toast.success(editing ? '里程碑已更新' : '里程碑已建立')
    } catch (requestError) {
      toast.error(errDetail(requestError, editing ? '更新里程碑失败' : '创建里程碑失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleStatus = async (milestone: Milestone, status: 'open' | 'completed') => {
    try {
      const saved = await updateMilestone(projectId, milestone.id, { status })
      applySavedMilestone(saved)
      toast.success(status === 'completed' ? '里程碑已完成' : '里程碑已重新开启')
    } catch (requestError) {
      toast.error(errDetail(requestError, '更新里程碑状态失败'))
    }
  }

  const handleDelete = async (milestone: Milestone) => {
    const confirmed = await confirmAction({
      title: '删除里程碑',
      description: `里程碑「${milestone.title}」将被永久删除，关联任务会保留。`,
      confirmLabel: '删除里程碑',
      tone: 'danger',
      icon: 'delete',
    })
    if (!confirmed) return
    try {
      await deleteMilestone(projectId, milestone.id)
      setMilestones((current) => current.filter((item) => item.id !== milestone.id))
      setDialogMilestones((current) => current?.filter((item) => item.id !== milestone.id) ?? null)
      setSelectedId(null)
      toast.success('里程碑已删除')
    } catch (requestError) {
      toast.error(errDetail(requestError, '删除里程碑失败'))
    }
  }

  if (supportLoading || timelineLoading) {
    return (
      <div className="milestone-loading">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p>正在校准交付轨道...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="milestone-loading">
        <AlertCircle className="h-8 w-8 text-danger" />
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={() => {
          void loadSupportData()
          void loadInitialTimeline()
        }}>
          <RefreshCw className="h-4 w-4" />重试
        </Button>
      </div>
    )
  }

  return (
    <div className="milestone-workspace">
      <section className="milestone-toolbar" aria-labelledby="milestone-page-title">
        <div className="milestone-toolbar-main">
          <div className="milestone-title-group">
            <span className="milestone-title-icon"><Flag className="h-5 w-5" /></span>
            <div>
              <h1 id="milestone-page-title">里程碑</h1>
              <p>按目标日期查看交付节奏与后续安排</p>
            </div>
          </div>
          <div className="milestone-toolbar-actions">
            <div className="milestone-metrics" aria-label="里程碑概览">
              <div><span>已载入</span><strong>{String(milestones.length).padStart(2, '0')}</strong></div>
              <div><span>风险</span><strong className={atRiskCount ? 'text-danger' : ''}>{String(atRiskCount).padStart(2, '0')}</strong></div>
              <div><span>平均进度</span><strong>{overallProgress}%</strong></div>
              <div><span>任务</span><strong>{milestones.reduce((sum, item) => sum + item.task_total, 0)}</strong></div>
            </div>
            {!isViewer && (
              <Button onClick={openCreate} className="milestone-create-button">
                <Plus className="h-4 w-4" />建立节点
              </Button>
            )}
          </div>
        </div>

        <div className="milestone-view-switch" role="tablist" aria-label="里程碑视图">
          {([
            ['open', '推进中', CircleDot],
            ['completed', '已归档', CheckCircle2],
            ['all', '全部', Flag],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={cn(view === value && 'is-active')}
            >
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
      </section>

      {milestones.length === 0 && !hasMorePast && !hasMoreFuture ? (
        <section className="milestone-empty">
          <Flag className="h-8 w-8" />
          <h2>当前时间之后没有节点</h2>
          <p>切换视图，或建立新的交付节点。</p>
          {!isViewer && <Button onClick={openCreate}><Plus className="h-4 w-4" />建立节点</Button>}
        </section>
      ) : (
        <>
          <section className="milestone-timeline-section" aria-label="里程碑时间线">
            <header className="milestone-timeline-heading">
              <div><CalendarClock className="h-4 w-4" /><strong>交付时间线</strong></div>
              <div className="milestone-timeline-controls">
                {hasMorePast && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={loadingPast}
                    onClick={() => {
                      historyStartedRef.current = true
                      setHistoryStarted(true)
                      void loadPast()
                    }}
                  >
                    {loadingPast ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
                    {historyStarted ? '加载更早' : '加载历史'}
                  </Button>
                )}
                <span>{milestones.length} 个节点 · 按自然日比例</span>
                {loadingFuture && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="正在加载后续里程碑" />}
              </div>
            </header>
            <div
              ref={timelineScrollRef}
              className="milestone-timeline-scroll scrollbar-thin"
              onScroll={(event) => {
                if (historyStartedRef.current && event.currentTarget.scrollLeft < 8) {
                  void loadPast()
                }
              }}
            >
              <div
                className="milestone-timeline-canvas"
                style={{
                  width: `${timelineLayout.width}px`,
                  '--today-x': `${timelineLayout.todayX}px`,
                  '--today-y': `${timelineLayout.todayY}px`,
                } as CSSProperties}
              >
                <svg
                  className="milestone-curve-track"
                  width={timelineLayout.width}
                  height={TIMELINE_CANVAS_HEIGHT}
                  viewBox={`0 0 ${timelineLayout.width} ${TIMELINE_CANVAS_HEIGHT}`}
                  aria-hidden="true"
                >
                  <path className="milestone-curve-aura" d={timelineLayout.curvePath} />
                  <motion.path
                    className="milestone-curve-core"
                    d={timelineLayout.curvePath}
                    initial={reduceMotion ? false : { pathLength: 0, opacity: 0.25 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: reduceMotion ? 0 : 0.85, ease: [0.22, 1, 0.36, 1] }}
                  />
                  <motion.path
                    className="milestone-curve-flow"
                    d={timelineLayout.curvePath}
                    animate={reduceMotion ? undefined : { strokeDashoffset: [0, -40] }}
                    transition={reduceMotion ? undefined : { duration: 6, ease: 'linear', repeat: Infinity }}
                  />
                </svg>
                {timelineIntervals.map((interval, index) => interval.days > 0 && (
                  <span
                    key={`${interval.x}-${index}`}
                    className="milestone-timeline-gap"
                    style={{
                      left: `${interval.x}px`,
                      top: `${interval.y + (interval.y >= timelineLayout.todayY ? -14 : 14)}px`,
                    }}
                  >
                    {timelineGapCopy(interval.days).replace('相隔 ', '')}
                  </span>
                ))}
                <span className="milestone-today-marker" aria-label={`今天 ${anchorDate}`}>
                  <span>今天</span>
                  <strong>{format(parseISO(anchorDate), 'MM.dd')}</strong>
                  <i />
                </span>
              {timelineLayout.items.map(({ milestone, x, y, cardLeft, lane }, index) => {
                const health = healthConfig[milestone.health]
                const HealthIcon = health.icon
                const isSelected = selected?.id === milestone.id
                const nodeStyle = {
                  '--node-x': `${x}px`,
                  '--node-y': `${y}px`,
                  '--card-left': `${cardLeft}px`,
                } as CSSProperties
                return (
                  <div
                    key={milestone.id}
                    className={cn('milestone-timeline-node', `is-lane-${lane}`, health.className)}
                    style={nodeStyle}
                  >
                    <motion.button
                      type="button"
                      className={cn('milestone-timeline-card', health.className, isSelected && 'is-selected')}
                      onClick={() => setSelectedId(milestone.id)}
                      initial={reduceMotion ? false : { opacity: 0, y: lane >= 2 ? 12 : -12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: reduceMotion ? 0 : Math.min(index, 8) * 0.04,
                        duration: reduceMotion ? 0 : undefined,
                        type: reduceMotion ? 'tween' : 'spring',
                        stiffness: 260,
                        damping: 24,
                      }}
                    >
                      <span className="milestone-timeline-card-top">
                        <span className="milestone-timeline-date">
                          <strong>{format(parseISO(milestone.target_date), 'MM.dd')}</strong>
                          <small>{format(parseISO(milestone.target_date), 'yyyy')}</small>
                        </span>
                        <span className="milestone-timeline-health"><HealthIcon className="h-3.5 w-3.5" />{health.label}</span>
                      </span>
                      <span className="milestone-timeline-title">{milestone.title}</span>
                      <span className="milestone-timeline-meta">
                        <span>{targetCopy(milestone.target_date, milestone.health)}</span>
                        <span>{milestone.task_completed}/{milestone.task_total} 项</span>
                      </span>
                      <span className="milestone-timeline-progress"><i style={{ width: `${milestone.progress}%` }} /></span>
                    </motion.button>
                    <span className="milestone-timeline-stem" aria-hidden="true" />
                    <span className="milestone-timeline-pin" aria-hidden="true" />
                  </div>
                )
              })}
                <span
                  ref={futureSentinelRef}
                  className="milestone-future-sentinel"
                  style={{ left: `${timelineLayout.width - 8}px` }}
                  aria-hidden="true"
                />
              </div>
            </div>
          </section>

          <AnimatePresence mode="wait">
            {selected && (
              <motion.section
                key={selected.id}
                className="milestone-detail"
                initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: reduceMotion ? 0 : 0.28 }}
              >
                <div className="milestone-detail-main">
                  <div className="milestone-detail-heading">
                    <div>
                      <span className={cn('milestone-health-label', healthConfig[selected.health].className)}>
                        {(() => {
                          const Icon = healthConfig[selected.health].icon
                          return <Icon className="h-4 w-4" />
                        })()}
                        {healthConfig[selected.health].label}
                      </span>
                      <h2>{selected.title}</h2>
                    </div>
                    {!isViewer && (
                      <DropdownMenu
                        align="end"
                        trigger={
                          <Button variant="ghost" size="icon" aria-label="里程碑操作" className="h-9 w-9">
                            <MoreHorizontal className="h-5 w-5" />
                          </Button>
                        }
                      >
                        <DropdownMenuItem onClick={() => openEdit(selected)}>
                          <Edit3 className="mr-2 h-4 w-4" />编辑
                        </DropdownMenuItem>
                        {selected.status === 'completed' ? (
                          <DropdownMenuItem onClick={() => void handleStatus(selected, 'open')}>
                            <RotateCcw className="mr-2 h-4 w-4" />重新开启
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void handleStatus(selected, 'completed')}>
                            <Check className="mr-2 h-4 w-4" />标记完成
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-danger focus:text-danger" onClick={() => void handleDelete(selected)}>
                          <Trash2 className="mr-2 h-4 w-4" />删除
                        </DropdownMenuItem>
                      </DropdownMenu>
                    )}
                  </div>

                  <p className="milestone-description">
                    {selected.description || '尚未记录验收说明。'}
                  </p>

                  <div className="milestone-facts">
                    <div><CalendarDays className="h-4 w-4" /><span>目标日期</span><strong>{format(parseISO(selected.target_date), 'yyyy年M月d日', { locale: zhCN })}</strong></div>
                    <div><CalendarClock className="h-4 w-4" /><span>时间坐标</span><strong>{targetCopy(selected.target_date, selected.health)}</strong></div>
                    <div><UserRound className="h-4 w-4" /><span>负责人</span><strong>{selected.owner?.display_name || '未指定'}</strong></div>
                  </div>
                </div>

                <aside className="milestone-progress-panel" aria-label="完成进度">
                  <span>PROGRESS</span>
                  <strong>{selected.progress}<small>%</small></strong>
                  <div className="milestone-progress-track"><i style={{ width: `${selected.progress}%` }} /></div>
                  <p>{selected.task_completed} 项已完成，{Math.max(selected.task_total - selected.task_completed, 0)} 项待推进</p>
                </aside>

                <div className="milestone-task-strip">
                  <div className="milestone-task-strip-heading">
                    <div><span>DELIVERABLES</span><h3>关联任务</h3></div>
                    <span>{selectedTasks.length} 项</span>
                  </div>
                  {selectedTasks.length === 0 ? (
                    <p className="milestone-no-tasks">此节点尚未关联任务。</p>
                  ) : (
                    <div className="milestone-task-list">
                      {selectedTasks.map((task, index) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => navigate(`/project/${projectId}/board?task=${task.id}`)}
                        >
                          <span className={cn('milestone-task-state', task.is_completed && 'is-done')}>
                            {task.is_completed ? <Check className="h-3.5 w-3.5" /> : <span />}
                          </span>
                          <span className="milestone-task-number">{String(index + 1).padStart(2, '0')}</span>
                          <span className={cn('milestone-task-title', task.is_completed && 'is-done')}>{task.title}</span>
                          <span className="milestone-task-people">
                            {task.assignees.slice(0, 3).map((assignee) => (
                              <Avatar key={assignee.id} name={assignee.display_name} src={assignee.avatar_url} size="xs" />
                            ))}
                          </span>
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </>
      )}

      <MilestoneDialog
        open={dialogOpen}
        milestone={editing}
        milestones={dialogMilestones ?? milestones}
        members={members}
        tasks={tasks}
        saving={saving}
        onClose={() => {
          if (!saving) {
            setDialogOpen(false)
            setEditing(null)
          }
        }}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
