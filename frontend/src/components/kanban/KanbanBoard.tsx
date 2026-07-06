import { useState, useEffect } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useParams } from 'react-router-dom'
import api from '../../utils/api'
import { KanbanColumn } from './KanbanColumn'
import { KanbanCard } from './KanbanCard'
import { CreateTaskDialog } from './CreateTaskDialog'
import { LLMChatPanel } from '../llm-chat/LLMChatPanel'
import { Plus, Sparkles, MessageSquare } from 'lucide-react'

interface Task {
  id: number
  title: string
  description: string
  status_id: number
  priority: number
  order: number
  assignee_id: number | null
  due_date: string | null
  is_completed: boolean
  assignee?: { id: number; display_name: string } | null
}

interface Status {
  id: number
  project_id: number
  name: string
  order: number
  color: string
  is_done: boolean
  task_count: number
}

export default function KanbanBoard() {
  const { projectId } = useParams()
  const [statuses, setStatuses] = useState<Status[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [createStatusId, setCreateStatusId] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null)
    const { active, over } = event
    if (!over || !projectId) return

    const taskId = active.id as number
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return

    // Determine new status and order
    let newStatusId: number
    let newOrder: number

    if (over.id.toString().startsWith('status-')) {
      // Dropped on column
      newStatusId = parseInt(over.id.toString().replace('status-', ''))
      const statusTasks = getTasksByStatus(newStatusId)
      newOrder = statusTasks.length > 0 ? statusTasks[statusTasks.length - 1].order + 1 : 0
    } else {
      // Dropped on or near another task
      const overTask = tasks.find((t) => t.id === over.id)
      if (!overTask) return
      newStatusId = overTask.status_id
      newOrder = overTask.order + 0.5
    }

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
      // Refresh to get canonical order
      const res = await api.get(`/projects/${projectId}/tasks`)
      setTasks(res.data)
    } catch {
      // Revert
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
      <div className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">任务看板</h3>
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
        <div className="w-96 border-l bg-white flex-shrink-0">
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
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateTask}
        />
      )}
    </div>
  )
}
