import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Target,
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
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [members, setMembers] = useState<MemberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewFilter>('open')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [saving, setSaving] = useState(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadWorkspace = useCallback(async (showLoading = true) => {
    if (!projectId) return
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const [nextMilestones, nextTasks, membersResponse] = await Promise.all([
        listMilestones(projectId),
        loadAllTasks(projectId),
        api.get(`/projects/${projectId}/members`),
      ])
      setMilestones(nextMilestones)
      setTasks(nextTasks)
      setMembers(membersResponse.data)
      setSelectedId((current) =>
        current && nextMilestones.some((item) => item.id === current)
          ? current
          : (nextMilestones.find((item) => item.status === 'open')?.id ?? nextMilestones[0]?.id ?? null),
      )
    } catch (requestError) {
      setError(errDetail(requestError, '里程碑工作台加载失败'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount loader updates state after awaiting requests
    void loadWorkspace()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [loadWorkspace])

  useProjectSocket(projectId || undefined, (event) => {
    if (!event.type.startsWith('milestone_') && !event.type.startsWith('task_')) return
    if (event.actor_id && event.actor_id === currentUserId) return
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void loadWorkspace(false), 250)
  })

  const filtered = useMemo(() => {
    if (view === 'all') return milestones
    if (view === 'completed') {
      return milestones.filter((milestone) => milestone.status !== 'open')
    }
    return milestones.filter((milestone) => milestone.status === 'open')
  }, [milestones, view])

  const selected = milestones.find((milestone) => milestone.id === selectedId) ?? filtered[0] ?? null
  const selectedTasks = selected
    ? selected.task_ids
        .map((id) => tasks.find((task) => task.id === id))
        .filter((task): task is TaskSummary => Boolean(task))
    : []
  const openCount = milestones.filter((milestone) => milestone.status === 'open').length
  const atRiskCount = milestones.filter((milestone) =>
    ['at_risk', 'overdue'].includes(milestone.health),
  ).length
  const overallProgress = milestones.length
    ? Math.round(milestones.reduce((sum, milestone) => sum + milestone.progress, 0) / milestones.length)
    : 0

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (milestone: Milestone) => {
    setEditing(milestone)
    setDialogOpen(true)
  }

  const handleSubmit = async (input: MilestoneInput) => {
    setSaving(true)
    try {
      const saved = editing
        ? await updateMilestone(projectId, editing.id, input)
        : await createMilestone(projectId, input)
      await loadWorkspace(false)
      setSelectedId(saved.id)
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
      await updateMilestone(projectId, milestone.id, { status })
      await loadWorkspace(false)
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
      await loadWorkspace(false)
      toast.success('里程碑已删除')
    } catch (requestError) {
      toast.error(errDetail(requestError, '删除里程碑失败'))
    }
  }

  if (loading) {
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
        <Button variant="outline" size="sm" onClick={() => void loadWorkspace()}>
          <RefreshCw className="h-4 w-4" />重试
        </Button>
      </div>
    )
  }

  return (
    <div className="milestone-workspace">
      <section className="milestone-stage" aria-labelledby="milestone-page-title">
        <div className="milestone-stage-mark" aria-hidden="true">M</div>
        <div className="milestone-stage-top">
          <div>
            <div className="milestone-kicker"><Target className="h-4 w-4" />DELIVERY COORDINATES</div>
            <h1 id="milestone-page-title">里程碑轨道</h1>
            <p>把任务压缩成清晰的交付节点，持续校准时间、责任与完成边界。</p>
          </div>
          {!isViewer && (
            <Button onClick={openCreate} className="milestone-create-button">
              <Plus className="h-4 w-4" />建立节点
            </Button>
          )}
        </div>

        <div className="milestone-metrics" aria-label="里程碑概览">
          <div><span>活跃节点</span><strong>{String(openCount).padStart(2, '0')}</strong></div>
          <div><span>风险信号</span><strong className={atRiskCount ? 'text-danger' : ''}>{String(atRiskCount).padStart(2, '0')}</strong></div>
          <div><span>平均完成度</span><strong>{overallProgress}<small>%</small></strong></div>
          <div><span>关联任务</span><strong>{milestones.reduce((sum, item) => sum + item.task_total, 0)}</strong></div>
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

      {filtered.length === 0 ? (
        <section className="milestone-empty">
          <Flag className="h-8 w-8" />
          <h2>{milestones.length ? '当前视图没有节点' : '建立第一个交付节点'}</h2>
          <p>{milestones.length ? '切换视图以查看其他里程碑。' : '里程碑将任务、时间和负责人组织成可追踪的交付轨道。'}</p>
          {!isViewer && !milestones.length && <Button onClick={openCreate}><Plus className="h-4 w-4" />建立节点</Button>}
        </section>
      ) : (
        <>
          <section className="milestone-rail-section" aria-label="里程碑时间轨道">
            <div className="milestone-rail-line" aria-hidden="true" />
            <div className="milestone-rail scrollbar-thin">
              {filtered.map((milestone, index) => {
                const health = healthConfig[milestone.health]
                const HealthIcon = health.icon
                const isSelected = selected?.id === milestone.id
                return (
                  <motion.button
                    key={milestone.id}
                    type="button"
                    className={cn('milestone-node', health.className, isSelected && 'is-selected')}
                    onClick={() => setSelectedId(milestone.id)}
                    initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: reduceMotion ? 0 : index * 0.055, type: 'spring', stiffness: 310, damping: 28 }}
                  >
                    <span className="milestone-node-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="milestone-node-signal"><HealthIcon className="h-4 w-4" /></span>
                    <span className="milestone-node-date">
                      {format(parseISO(milestone.target_date), 'MM.dd')}
                      <small>{format(parseISO(milestone.target_date), 'yyyy')}</small>
                    </span>
                    <span className="milestone-node-title">{milestone.title}</span>
                    <span className="milestone-node-meta">
                      <span>{health.label}</span>
                      <span>{milestone.task_completed}/{milestone.task_total}</span>
                    </span>
                    <span className="milestone-node-progress">
                      <i style={{ width: `${milestone.progress}%` }} />
                    </span>
                  </motion.button>
                )
              })}
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
        milestones={milestones}
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
