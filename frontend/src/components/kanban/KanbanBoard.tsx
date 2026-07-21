import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useParams } from 'react-router-dom'
import api from '../../utils/api'
import { useProjectRole } from '../../hooks/useProjectRole'
import { useProjectSocket } from '../../hooks/useProjectSocket'
import { useResizableWidth } from '../../hooks/useResizableWidth'
import { useAuthStore } from '../../stores/authStore'
import { KanbanColumn } from './KanbanColumn'
import { KanbanCard } from './KanbanCard'
import { CreateTaskDialog } from './CreateTaskDialog'
import { TaskDetailDialog } from './TaskDetailDialog'
import { StatusManagerDialog } from './StatusManagerDialog'
import { LLMChatPanel } from '../llm-chat/LLMChatPanel'
import { loadOpenState, saveOpenState } from '../llm-chat/floatingGeometry'
import { AlertCircle, ArrowDown, ArrowUp, Columns3, Filter, Loader2, MessageSquare, Plus, RefreshCw, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Badge } from '../ui/Badge'
import type { TaskSummary, TaskStatus, MemberOption, ActionSummary } from '../../types'

/** 与后端 Task.priority 一致：0=none, 1=low, 2=medium, 3=high, 4=urgent */
const PRIORITY_OPTIONS = [
  { value: 0, label: '无' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' },
  { value: 4, label: '紧急' },
]

type SortKey = 'manual' | 'created_at' | 'updated_at' | 'priority' | 'due_date'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'manual', label: '手动排序' },
  { value: 'created_at', label: '创建时间' },
  { value: 'updated_at', label: '更新时间' },
  { value: 'priority', label: '优先级' },
  { value: 'due_date', label: '截止日期' },
]

export default function KanbanBoard() {
  const { projectId } = useParams()
  const userRole = useProjectRole()
  const isViewer = userRole === 'viewer'
  const canManageStatuses = userRole === 'owner' || userRole === 'admin'
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [activeTask, setActiveTask] = useState<TaskSummary | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showChat, setShowChatRaw] = useState(() => loadOpenState())
  const setShowChat = useCallback((open: boolean | ((v: boolean) => boolean)) => {
    setShowChatRaw((prev) => {
      const next = typeof open === 'function' ? open(prev) : open
      saveOpenState(next)
      return next
    })
  }, [])
  const [createStatusId, setCreateStatusId] = useState<number | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null)
  const [boardLoading, setBoardLoading] = useState(true)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [showStatusManager, setShowStatusManager] = useState(false)
  const { width: columnWidth, startResize: startColumnResize } = useResizableWidth({
    storageKey: 'flowmind.kanban.columnWidth',
    defaultWidth: 288,
    min: 240,
    max: 480,
  })

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<number | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('manual')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [members, setMembers] = useState<MemberOption[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentUserId = useAuthStore((s) => s.user?.id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const fetchTasks = useCallback(async (search?: string, assigneeId?: number | null) => {
    if (!projectId) return
    const params: Record<string, string> = { page: '1', page_size: '100' }
    if (search) params.search = search
    if (assigneeId) params.assignee_id = String(assigneeId)
    const res = await api.get(`/projects/${projectId}/tasks`, { params })
    return res.data.items as TaskSummary[]
  }, [projectId])

  const loadTasks = useCallback(async (search?: string, assigneeId?: number | null, showError = true) => {
    try {
      const nextTasks = await fetchTasks(search, assigneeId)
      if (nextTasks) setTasks(nextTasks)
      return nextTasks
    } catch (err) {
      if (showError) toast.error('加载任务失败')
      throw err
    }
  }, [fetchTasks])

  const loadBoard = useCallback(async () => {
    if (!projectId) return
    setBoardLoading(true)
    setBoardError(null)
    try {
      const [statusesRes, nextTasks] = await Promise.all([
        api.get(`/projects/${projectId}/statuses`),
        fetchTasks(),
      ])
      setStatuses(statusesRes.data)
      setTasks(nextTasks || [])
    } catch {
      setBoardError('看板加载失败')
      toast.error('加载看板失败')
    } finally {
      setBoardLoading(false)
    }
  }, [projectId, fetchTasks])

  useEffect(() => {
    if (!projectId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting filters on project switch, before async fetch
    setSearchQuery('')
    setAssigneeFilter(null)
    setPriorityFilter(null)
    setSortKey('manual')
    setSortDir('asc')
    loadBoard()
    api.get(`/projects/${projectId}/members`)
      .then((res) => setMembers(res.data))
      .catch(() => toast.error('加载成员列表失败'))

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (wsRefreshRef.current) clearTimeout(wsRefreshRef.current)
    }
  }, [projectId, loadBoard])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void loadTasks(value, assigneeFilter).catch(() => {})
    }, 300)
  }

  const handleAssigneeFilter = (id: number | null) => {
    setAssigneeFilter(id)
    void loadTasks(searchQuery, id).catch(() => {})
  }

  const clearFilters = () => {
    setSearchQuery('')
    setAssigneeFilter(null)
    setPriorityFilter(null)
    setSortKey('manual')
    setSortDir('asc')
    void loadTasks(undefined, null).catch(() => {})
  }

  const hasActiveFilters = searchQuery || assigneeFilter !== null || priorityFilter !== null || sortKey !== 'manual'

  // 优先级过滤在已加载任务上纯前端进行（任务随看板全量加载）
  const visibleTasks = useMemo(
    () => (priorityFilter === null ? tasks : tasks.filter((t) => t.priority === priorityFilter)),
    [tasks, priorityFilter]
  )

  // Real-time sync: refresh the board when other clients mutate the project.
  // Refetches are idempotent and debounced; events from this client are
  // ignored because local mutations already update state optimistically.
  // If the socket is down nothing breaks — the board works as before.
  useProjectSocket(projectId ? parseInt(projectId) : undefined, (event) => {
    if (event.actor_id && event.actor_id === currentUserId) return
    if (wsRefreshRef.current) clearTimeout(wsRefreshRef.current)
    wsRefreshRef.current = setTimeout(() => {
      if (event.type.startsWith('status_')) {
        void loadBoard().catch(() => {})
      } else {
        void loadTasks(searchQuery, assigneeFilter, false).catch(() => {})
      }
    }, 300)
  })

  const getTasksByStatus = (statusId: number) => {
    const list = visibleTasks.filter((t) => t.status_id === statusId)
    if (sortKey === 'manual') return list.sort((a, b) => a.order - b.order)
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      if (sortKey === 'priority') return (a.priority - b.priority) * dir
      const av = a[sortKey]
      const bv = b[sortKey]
      if (sortKey === 'due_date') {
        // 无截止日期的任务始终排在最后
        if (!av && !bv) return 0
        if (!av) return 1
        if (!bv) return -1
      }
      return (new Date(av as string).getTime() - new Date(bv as string).getTime()) * dir
    })
  }

  // Reset board-local UI state only when the project actually changes
  // (StrictMode-safe: comparing the param survives double-effect replays,
  // and the persisted "chat open" state survives page reloads)
  const prevProjectRef = useRef(projectId)
  useEffect(() => {
    if (prevProjectRef.current === projectId) return
    prevProjectRef.current = projectId
    setShowCreateDialog(false)
    setShowStatusManager(false)
    setShowChat(false)
    setDetailTaskId(null)
    setActiveTask(null)
    setCreateStatusId(null)
  }, [projectId, setShowChat])

  const handleDragStart = (event: DragStartEvent) => {
    if (isViewer) return
    const task = tasks.find((t) => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  const getNewOrder = (statusId: number, overTaskId?: number): [number, number, number] => {
    const statusTasks = tasks.filter((t) => t.status_id === statusId).sort((a, b) => a.order - b.order)
    if (!overTaskId) {
      return [statusId, statusTasks.length > 0 ? statusTasks[statusTasks.length - 1].order + 1000 : 0, 0]
    }
    const overIndex = statusTasks.findIndex((t) => t.id === overTaskId)
    if (overIndex === -1) return [statusId, 0, 0]
    const prevOrder = overIndex > 0 ? statusTasks[overIndex - 1].order : -1000
    const nextOrder = overIndex < statusTasks.length - 1 ? statusTasks[overIndex + 1].order : statusTasks[statusTasks.length - 1].order + 1000
    return [statusId, (prevOrder + nextOrder) / 2, 1]
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null)
    if (isViewer) return
    const { active, over } = event
    if (!over || !projectId) return
    const taskId = active.id as number
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    let newStatusId: number
    let newOrder: number
    if (over.id.toString().startsWith('status-')) {
      newStatusId = parseInt(over.id.toString().replace('status-', ''))
      newOrder = getNewOrder(newStatusId)[1]
    } else {
      const overTask = tasks.find((t) => t.id === over.id)
      if (!overTask) return
      newStatusId = overTask.status_id
      newOrder = getNewOrder(newStatusId, overTask.id)[1]
    }
    if (task.status_id === newStatusId && task.order === newOrder) return
    const previousTasks = tasks
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status_id: newStatusId, order: newOrder } : t
      )
    )
    try {
      await api.patch(`/projects/${projectId}/tasks/${taskId}/move`, {
        status_id: newStatusId,
        order: newOrder,
      })
    } catch {
      setTasks(previousTasks)
      toast.error('移动失败，已还原')
      return
    }
    void loadTasks(searchQuery, assigneeFilter, false).catch(() => {
      toast.error('任务已移动，但刷新失败')
    })
  }

  const handleCreateTask = async (data: {
    title: string
    description?: string
    status_id: number
    priority?: number
    assignee_ids?: number[]
    due_date?: string | null
  }) => {
    if (!projectId || isViewer) return
    const res = await api.post(`/projects/${projectId}/tasks`, data)
    setTasks((prev) => [...prev, res.data])
  }

  const handleAssignTask = async (taskId: number, userIds: number[]) => {
    if (!projectId || isViewer) return
    const previousTasks = tasks
    const assignees = members
      .filter((m) => userIds.includes(m.user_id))
      .map((m) => ({ id: m.user_id, display_name: m.display_name || m.username, avatar_url: m.avatar_url }))
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, assignees } : t
      )
    )
    try {
      await api.put(`/projects/${projectId}/tasks/${taskId}`, { assignee_ids: userIds })
      void loadTasks(searchQuery, assigneeFilter, false).catch(() => {})
    } catch {
      setTasks(previousTasks)
      toast.error('指派失败，已还原')
    }
  }

  const handleLLMActions = useCallback(
    (actions: ActionSummary[]) => {
      const needsRefresh = actions.some((a) =>
        [
          'create_task',
          'update_task',
          'move_task',
          'delete_task',
          'add_subtask',
          'update_subtask',
        ].includes(a.type)
      )
      if (needsRefresh) {
        void loadTasks(searchQuery, assigneeFilter, false)
      }
    },
    [loadTasks, searchQuery, assigneeFilter]
  )

  return (
    <div className="relative h-full min-w-0">
      <div className="h-full min-w-0 overflow-auto">
        <div className="surface p-4 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h3 className="section-title">任务看板</h3>
            <div className="flex items-center gap-2">
              {canManageStatuses && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowStatusManager(true)}
                  className="gap-1.5"
                  aria-label="管理状态列"
                >
                  <Columns3 className="h-4 w-4" />
                  <span className="hidden sm:inline">状态列</span>
                </Button>
              )}
              {!isViewer && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowChat(!showChat)}
                  className="gap-1.5"
                  aria-label="LLM 助手"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="hidden sm:inline">LLM 助手</span>
                </Button>
              )}
              {!isViewer && (
                <Button
                  size="sm"
                  disabled={statuses.length === 0 || boardLoading}
                  onClick={() => {
                    setCreateStatusId(statuses[0]?.id || null)
                    setShowCreateDialog(true)
                  }}
                  className="gap-1.5"
                  aria-label="新建任务"
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">新建任务</span>
                </Button>
              )}
            </div>
          </div>

          {/* Search & Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="搜索任务标题或描述..."
                className="pl-9 text-sm"
              />
              {searchQuery && (
                <button
                  aria-label="清除搜索"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => handleSearchChange('')}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select
              value={assigneeFilter || ''}
              onChange={(e) => handleAssigneeFilter(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full sm:w-auto text-sm"
              aria-label="按指派人筛选"
            >
              <option value="">全部指派人</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name || m.username}
                </option>
              ))}
            </Select>
            <Select
              value={priorityFilter ?? ''}
              onChange={(e) => setPriorityFilter(e.target.value === '' ? null : parseInt(e.target.value))}
              className="w-full sm:w-auto text-sm"
              aria-label="按优先级筛选"
            >
              <option value="">全部优先级</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1">
              <Select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="w-full sm:w-auto text-sm"
                aria-label="列内排序方式"
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              {sortKey !== 'manual' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  aria-label={sortDir === 'asc' ? '切换为降序' : '切换为升序'}
                  title={sortDir === 'asc' ? '当前升序，点击切换降序' : '当前降序，点击切换升序'}
                >
                  {sortDir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                </Button>
              )}
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="gap-1 text-muted-foreground"
              >
                <Filter className="h-3.5 w-3.5" />
                清除过滤
              </Button>
            )}
            <Badge variant="secondary" className="sm:ml-auto text-xs">
              {priorityFilter !== null ? `${visibleTasks.length} / ${tasks.length} 个任务` : `${tasks.length} 个任务`}
            </Badge>
          </div>
        </div>

        {boardLoading ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card p-10 text-center">
            <Loader2 className="h-7 w-7 text-primary animate-spin mb-3" />
            <p className="body-text">正在加载看板...</p>
          </div>
        ) : boardError ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card p-10 text-center">
            <AlertCircle className="h-8 w-8 text-danger mb-3" />
            <p className="text-sm text-foreground mb-4">{boardError}</p>
            <Button variant="outline" size="sm" onClick={loadBoard} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              重试
            </Button>
          </div>
        ) : (
          <>
            {statuses.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-10 text-center body-text">
                暂无任务状态
              </div>
            ) : (
              <DndContext
                sensors={isViewer ? [] : sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <div
                  className="flex flex-col lg:flex-row gap-4 lg:overflow-x-auto pb-4 scrollbar-thin"
                  style={{ minHeight: 'calc(100vh - 260px)' }}
                >
                  {statuses.map((status) => (
                    <KanbanColumn
                      key={status.id}
                      status={status}
                      tasks={getTasksByStatus(status.id)}
                      members={members}
                      readOnly={isViewer}
                      columnWidth={columnWidth}
                      onColumnResizeStart={startColumnResize}
                      onAddTask={() => {
                        setCreateStatusId(status.id)
                        setShowCreateDialog(true)
                      }}
                      onTaskClick={(taskId) => setDetailTaskId(taskId)}
                      onAssignTask={handleAssignTask}
                    />
                  ))}
                </div>

                <DragOverlay>
                  {activeTask ? (
                    <div className="opacity-90" aria-hidden="true">
                      <KanbanCard task={activeTask} members={members} isDragOverlay readOnly />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </>
        )}
      </div>

      {/* LLM Chat floating window (fixed position — board keeps full width) */}
      {!isViewer && (
        <LLMChatPanel
          projectId={parseInt(projectId!)}
          open={showChat}
          onClose={() => setShowChat(false)}
          onActions={handleLLMActions}
          members={members}
        />
      )}

      {/* Floating trigger when the assistant panel is collapsed */}
      {!showChat && !isViewer && (
        <button
          type="button"
          onClick={() => setShowChat(true)}
          aria-label="打开 LLM 助手"
          className="fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-transform duration-200 hover:scale-105"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
      )}

      {/* Create Task Dialog */}
      {showCreateDialog && (
        <CreateTaskDialog
          statuses={statuses}
          defaultStatusId={createStatusId}
          projectId={parseInt(projectId!)}
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateTask}
        />
      )}

      {/* Status Manager Dialog */}
      {showStatusManager && (
        <StatusManagerDialog
          projectId={parseInt(projectId!)}
          onClose={() => setShowStatusManager(false)}
          onUpdated={() => {
            void loadBoard().catch(() => {})
          }}
        />
      )}

      {/* Task Detail Dialog */}
      {detailTaskId && (
        <TaskDetailDialog
          taskId={detailTaskId}
          projectId={parseInt(projectId!)}
          statuses={statuses.map((s) => ({ id: s.id, name: s.name }))}
          onClose={() => setDetailTaskId(null)}
          onUpdated={() => {
            void loadTasks(searchQuery, assigneeFilter).catch(() => {})
          }}
        />
      )}
    </div>
  )
}
