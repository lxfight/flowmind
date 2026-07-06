import { useState, useEffect, useRef, useCallback } from 'react'
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
import { KanbanColumn } from './KanbanColumn'
import { KanbanCard } from './KanbanCard'
import { CreateTaskDialog } from './CreateTaskDialog'
import { TaskDetailDialog } from './TaskDetailDialog'
import { LLMChatPanel } from '../llm-chat/LLMChatPanel'
import { AlertCircle, Filter, Loader2, MessageSquare, Plus, RefreshCw, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { TaskSummary, TaskStatus, MemberOption } from '../../types'

export default function KanbanBoard() {
  const { projectId } = useParams()
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [activeTask, setActiveTask] = useState<TaskSummary | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [createStatusId, setCreateStatusId] = useState<number | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null)
  const [boardLoading, setBoardLoading] = useState(true)
  const [boardError, setBoardError] = useState<string | null>(null)

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<number | null>(null)
  const [members, setMembers] = useState<MemberOption[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const fetchTasks = useCallback(async (search?: string, assigneeId?: number | null) => {
    if (!projectId) return
    const params: Record<string, string> = {}
    if (search) params.search = search
    if (assigneeId) params.assignee_id = String(assigneeId)
    const res = await api.get(`/projects/${projectId}/tasks`, { params })
    return res.data as TaskSummary[]
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
    setSearchQuery('')
    setAssigneeFilter(null)
    loadBoard()
    api.get(`/projects/${projectId}/members`)
      .then((res) => setMembers(res.data))
      .catch(() => toast.error('加载成员列表失败'))

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
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
    void loadTasks(undefined, null).catch(() => {})
  }

  const hasActiveFilters = searchQuery || assigneeFilter !== null

  const getTasksByStatus = (statusId: number) =>
    tasks.filter((t) => t.status_id === statusId).sort((a, b) => a.order - b.order)

  const handleDragStart = (event: DragStartEvent) => {
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
    assignee_id?: number | null
  }) => {
    if (!projectId) return
    const res = await api.post(`/projects/${projectId}/tasks`, data)
    setTasks((prev) => [...prev, res.data])
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 min-w-0 p-4 lg:p-6 overflow-auto dark:bg-gray-900">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold dark:text-gray-100">任务看板</h3>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary flex items-center gap-1.5 text-sm"
              onClick={() => setShowChat(!showChat)}
            >
              <MessageSquare size={16} />
              <span className="hidden sm:inline">LLM 助手</span>
            </button>
            <button
              className="btn-primary flex items-center gap-1.5 text-sm"
              disabled={statuses.length === 0 || boardLoading}
              onClick={() => {
                setCreateStatusId(statuses[0]?.id || null)
                setShowCreateDialog(true)
              }}
            >
              <Plus size={16} />
              <span className="hidden sm:inline">新建任务</span>
            </button>
          </div>
        </div>

        {boardLoading ? (
          <div className="card p-10 text-center">
            <Loader2 size={28} className="mx-auto mb-3 text-primary-500 animate-spin" />
            <p className="text-sm text-gray-500 dark:text-gray-400">正在加载看板...</p>
          </div>
        ) : boardError ? (
          <div className="card p-10 text-center">
            <AlertCircle size={32} className="mx-auto mb-3 text-red-500" />
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{boardError}</p>
            <button className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={loadBoard}>
              <RefreshCw size={15} />
              重试
            </button>
          </div>
        ) : (
          <>
            {/* Search & Filter bar */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="relative flex-1 min-w-[220px] max-w-xs">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input-field pl-8 text-sm"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="搜索任务标题或描述..."
                />
                {searchQuery && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => handleSearchChange('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <select
                className="input-field w-full sm:w-auto text-sm py-2"
                value={assigneeFilter || ''}
                onChange={(e) => handleAssigneeFilter(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">全部指派人</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name || m.username}
                  </option>
                ))}
              </select>
              {hasActiveFilters && (
                <button
                  className="btn-ghost text-xs flex items-center gap-1 text-gray-500"
                  onClick={clearFilters}
                >
                  <Filter size={13} />
                  清除过滤
                </button>
              )}
              <span className="text-xs text-gray-400 sm:ml-auto">
                {tasks.length} 个任务
              </span>
            </div>

            {statuses.length === 0 ? (
              <div className="card p-10 text-center text-sm text-gray-500 dark:text-gray-400">
                暂无任务状态
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 260px)' }}>
                  {statuses.map((status) => (
                    <KanbanColumn
                      key={status.id}
                      status={status}
                      tasks={getTasksByStatus(status.id)}
                      onAddTask={() => {
                        setCreateStatusId(status.id)
                        setShowCreateDialog(true)
                      }}
                      onTaskClick={(taskId) => setDetailTaskId(taskId)}
                    />
                  ))}
                </div>

                <DragOverlay>
                  {activeTask ? (
                    <div className="opacity-85">
                      <KanbanCard task={activeTask} isDragOverlay />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </>
        )}
      </div>

      {/* LLM Chat Side Panel */}
      {showChat && (
        <div className="fixed inset-0 z-40 bg-white dark:bg-gray-800 dark:border-gray-700 lg:static lg:z-auto lg:w-96 lg:border-l lg:flex-shrink-0">
          <LLMChatPanel
            projectId={parseInt(projectId!)}
            onClose={() => setShowChat(false)}
            onCreateTasks={() => {}}
          />
        </div>
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

      {/* Task Detail Dialog */}
      {detailTaskId && (
        <TaskDetailDialog
          taskId={detailTaskId}
          projectId={parseInt(projectId!)}
          onClose={() => setDetailTaskId(null)}
          onUpdated={() => {
            void loadTasks(searchQuery, assigneeFilter).catch(() => {})
          }}
        />
      )}
    </div>
  )
}
