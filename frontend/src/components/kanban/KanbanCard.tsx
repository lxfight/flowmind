import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { AlertCircle, Clock, ListTodo, MessageSquare } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Avatar } from '../ui/Avatar'
import { AssigneePicker } from './AssigneePicker'
import { cn } from '../../utils/cn'
import type { TaskCard, MemberOption } from '../../types'

interface Props {
  task: TaskCard
  members: MemberOption[]
  isDragOverlay?: boolean
  onClick?: () => void
  onAssign?: (userId: number | null) => void
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

export function KanbanCard({ task, members, isDragOverlay, onClick, onAssign }: Props) {
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
    task.subtask_count > 0
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
        'relative cursor-grab border-l-4 p-3 active:cursor-grabbing surface',
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
      {/* Header: priority + relative time */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <Badge variant={priority.variant} className="gap-1 text-[10px] h-5 px-1.5">
          <AlertCircle className="h-3 w-3" />
          {priority.label}
        </Badge>
        {task.updated_at && (
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(task.updated_at), { addSuffix: true, locale: zhCN })}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-medium leading-snug text-foreground">{task.title}</p>

      {/* Subtask progress */}
      {task.subtask_count > 0 && (
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

      {/* Meta footer */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {onAssign ? (
            <AssigneePicker
              members={members}
              value={task.assignee?.id || null}
              onChange={onAssign}
              size="sm"
            />
          ) : task.assignee ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <Avatar name={task.assignee.display_name} src={task.assignee.avatar_url} size="sm" />
              <span className="text-xs text-muted-foreground truncate max-w-[80px]">{task.assignee.display_name}</span>
            </div>
          ) : null}

          {task.due_date && (
            <span
              className={cn(
                'flex items-center gap-1 text-xs shrink-0',
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

        {task.comment_count > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <MessageSquare className="h-3 w-3" />
            {task.comment_count}
          </div>
        )}
      </div>
    </Card>
  )
}
