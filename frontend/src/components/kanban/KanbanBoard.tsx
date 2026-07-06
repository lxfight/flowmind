import { useState, useEffect } from 'react'
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
import { Plus, MessageSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import type { TaskSummary, TaskStatus } from '../../types'

export default function KanbanBoard() {
  const { projectId } = useParams()
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [activeTask, setActiveTask] = useState<TaskSummary | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [createStatusId, setCreateStatusId] = useState<number | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  )

  useEffect(() => {
    if (!projectId) return
    api.get(`/projects/${projectId}/statuses`).then((res) => setStatuses(res.data))
    api.get(`/projects/${projectId}/tasks`).then((res) => setTasks(res.data))
  }, [projectId])

  const getTasksByStatus = (statusId: number) =>
    tasks.filter((t) => t.status_id === statusId).sort((a, b) => a.order - b.order)

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  const getNewOrder = (statusId: number, overTaskId?: number): [number, number, number] => {
    const statusTasks = tasks.filter((t) => t.status_id === statusId).sort((a, b) => a.order - b.order)

    if (!overTaskId) {
      // Dropped at the end of column
      return [statusId, statusTasks.length > 0 ? statusTasks[statusTasks.length - 1].order + 1000 : 0, 0]
    }

    const overIndex = statusTasks.findIndex((t) => t.id === overTaskId)
    if (overIndex === -1) return [statusId, 0, 0]

    const prevOrder = overIndex > 0 ? statusTasks[overIndex - 1].order : -1000
    const nextOrder = overIndex < statusTasks.length - 1 ? statusTasks[overIndex + 1].order : statusTasks[statusTasks.length - 1].order + 1000
    const mid = (prevOrder + nextOrder) / 2

    return [statusId, mid, 1]
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
      // Dropped on column body - append to end
      newStatusId = parseInt(over.id.toString().replace('status-', ''))
      newOrder = getNewOrder(newStatusId)[1]
    } else {
      // Dropped on or near another task
      const overTask = tasks.find((t) => t.id === over.id)
      if (!overTask) return
      newStatusId = overTask.status_id
      newOrder = getNewOrder(newStatusId, overTask.id)[1]
    }

    if (task.status_id === newStatusId && task.order === newOrder) return

    // Optimistic update
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
      const res = await api.get(`/projects/${projectId}/tasks`)
      setTasks(res.data)
    } catch {
      toast.error('移动失败，已还原')
      const res = await api.get(`/projects/${projectId}/tasks`)
      setTasks(res.data)
    }
  }

  const handleCreateTask = async (data: {
    title: string
    description?: string
    status_id: number
    priority?: number
  }) => {
    if (!projectId) return
    const res = await api.post(`/projects/${projectId}/tasks`, data)
    setTasks((prev) => [...prev, res.data])
  }

  const handleLLMCreate = async (instruction: string) => {
    if (!projectId) return
    // In a production app, this would call the LLM generate-tasks endpoint
    // and then create the tasks. For now, use the simple create.
    alert(`LLM 任务创建功能: "${instruction}" — 需要配置 LLM_API_KEY`)
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-6 overflow-auto dark:bg-gray-900">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold dark:text-gray-100">任务看板</h3>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary flex items-center gap-1.5"
              onClick={() => setShowChat(!showChat)}
            >
              <MessageSquare size={16} />
              LLM 助手
            </button>
            <button
              className="btn-primary flex items-center gap-1.5"
              onClick={() => {
                setCreateStatusId(statuses[0]?.id || null)
                setShowCreateDialog(true)
              }}
            >
              <Plus size={16} />
              新建任务
            </button>
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
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
      </div>

      {/* LLM Chat Side Panel */}
      {showChat && (
        <div className="w-96 border-l bg-white dark:bg-gray-800 dark:border-gray-700 flex-shrink-0">
          <LLMChatPanel
            projectId={parseInt(projectId!)}
            onClose={() => setShowChat(false)}
            onCreateTasks={handleLLMCreate}
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
            api.get(`/projects/${projectId}/tasks`).then(res => setTasks(res.data))
          }}
        />
      )}
    </div>
  )
}
