import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertCircle, Clock, User, ListTodo } from 'lucide-react'
import { cn } from '../../utils/cn'
import type { TaskCard } from '../../types'

interface Props {
  task: TaskCard
  isDragOverlay?: boolean
  onClick?: () => void
}

const priorityConfig = {
  0: { color: 'text-gray-400', bg: 'bg-gray-400' },
  1: { color: 'text-blue-500', bg: 'bg-blue-500' },
  2: { color: 'text-yellow-500', bg: 'bg-yellow-500' },
  3: { color: 'text-orange-500', bg: 'bg-orange-500' },
  4: { color: 'text-red-500', bg: 'bg-red-500' },
} as const

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
      className={cn(
        'card p-3 cursor-grab active:cursor-grabbing border-l-4 relative overflow-hidden',
        isDragging && 'opacity-50',
        isDragOverlay && 'shadow-lg rotate-2',
        task.priority >= 3 ? 'border-l-red-400' : task.priority === 2 ? 'border-l-yellow-400' : 'border-l-transparent',
      )}
      onClick={(e) => {
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
              {['', '低', '中', '高', '紧急'][task.priority]}
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug">
        {task.title}
      </p>

      {/* Subtask progress bar */}
      {task.subtask_count !== undefined && task.subtask_count > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 mb-1">
            <ListTodo size={11} className="text-gray-400" />
            <span className="text-xs text-gray-400">
              {task.subtask_done || 0}/{task.subtask_count}
            </span>
          </div>
          <div className="w-full h-1 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-400 rounded-full transition-all duration-300"
              style={{ width: `${((task.subtask_done || 0) / task.subtask_count) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="flex items-center justify-between mt-2 text-xs text-gray-400 dark:text-gray-500">
        <div className="flex items-center gap-2">
          {task.assignee && (
            <span className="flex items-center gap-1">
              <User size={11} />
              {task.assignee.display_name}
            </span>
          )}
          {task.due_date && (
            <span className={cn('flex items-center gap-1', isOverdue && 'text-red-500')}>
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
