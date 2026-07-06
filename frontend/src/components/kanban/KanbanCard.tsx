import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertCircle, Clock, User } from 'lucide-react'

interface Task {
  id: number
  title: string
  priority: number
  assignee?: { display_name: string } | null
  due_date: string | null
}

interface Props {
  task: Task
  isDragOverlay?: boolean
  onClick?: () => void
}

const priorityConfig = {
  0: { color: 'text-gray-400', label: '' },
  1: { color: 'text-blue-500', label: '低' },
  2: { color: 'text-yellow-500', label: '中' },
  3: { color: 'text-orange-500', label: '高' },
  4: { color: 'text-red-500', label: '紧急' },
}

export function KanbanCard({ task, isDragOverlay, onClick }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const priority = priorityConfig[task.priority as keyof typeof priorityConfig] || priorityConfig[0]

  const isOverdue =
    task.due_date && new Date(task.due_date) < new Date() && !isDragOverlay

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`card p-3 cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-50' : ''
      } ${isDragOverlay ? 'shadow-lg rotate-2' : ''}`}
      onClick={(e) => {
        // Only trigger on click if not dragging
        if (!isDragging && onClick) {
          e.stopPropagation()
          onClick()
        }
      }}
    >
      {/* Priority badge */}
      {task.priority >= 2 && (
        <div className="flex items-center gap-1 mb-1.5">
          <AlertCircle size={12} className={priority.color} />
          {task.priority >= 3 && (
            <span className={`text-xs font-medium ${priority.color}`}>
              {priority.label}
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>

      {/* Meta */}
      <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          {task.assignee && (
            <span className="flex items-center gap-1">
              <User size={11} />
              {task.assignee.display_name}
            </span>
          )}
          {task.due_date && (
            <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500' : ''}`}>
              <Clock size={11} />
              {new Date(task.due_date).toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
