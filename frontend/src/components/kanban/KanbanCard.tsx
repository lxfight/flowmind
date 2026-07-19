import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertCircle, Clock, ListTodo } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Avatar } from '../ui/Avatar'
import { cn } from '../../utils/cn'
import type { TaskCard } from '../../types'

interface Props {
  task: TaskCard
  isDragOverlay?: boolean
  onClick?: () => void
}

const priorityConfig = {
  0: { label: '无', variant: 'secondary' as const },
  1: { label: '低', variant: 'info' as const },
  2: { label: '中', variant: 'warning' as const },
  3: { label: '高', variant: 'danger' as const },
  4: { label: '紧急', variant: 'danger' as const },
}

const priorityBorder = {
  0: 'border-l-transparent',
  1: 'border-l-info',
  2: 'border-l-warning',
  3: 'border-l-danger',
  4: 'border-l-danger',
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
  const border = priorityBorder[task.priority as keyof typeof priorityBorder] || priorityBorder[0]

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !isDragOverlay

  const subtaskProgress =
    task.subtask_count && task.subtask_count > 0
      ? Math.round(((task.subtask_done || 0) / task.subtask_count) * 100)
      : 0

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      hover={!isDragOverlay && !isDragging}
      className={cn(
        'relative cursor-grab border-l-4 p-3 active:cursor-grabbing',
        border,
        isDragging && 'opacity-40',
        isDragOverlay && 'shadow-lg rotate-2 scale-105 cursor-grabbing'
      )}
      onClick={(e) => {
        if (!isDragging && onClick) {
          e.stopPropagation()
          onClick()
        }
      }}
    >
      {/* Priority badge */}
      {task.priority >= 1 && (
        <div className="mb-1.5">
          <Badge variant={priority.variant} className="gap-1 text-[10px] h-5 px-1.5">
            <AlertCircle className="h-3 w-3" />
            {priority.label}
          </Badge>
        </div>
      )}

      {/* Title */}
      <p className="text-sm font-medium leading-snug text-foreground">{task.title}</p>

      {/* Subtask progress */}
      {task.subtask_count !== undefined && task.subtask_count > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ListTodo className="h-3 w-3" />
            <span>{task.subtask_done || 0}/{task.subtask_count}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${subtaskProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {task.assignee && (
            <div className="flex items-center gap-1">
              <Avatar name={task.assignee.display_name} size="sm" />
            </div>
          )}
          {task.due_date && (
            <span
              className={cn(
                'flex items-center gap-1 text-xs',
                isOverdue ? 'text-danger font-medium' : 'text-muted-foreground'
              )}
            >
              <Clock className="h-3 w-3" />
              {new Date(task.due_date).toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}
