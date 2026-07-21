import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { AlertCircle, Clock, GripVertical, ListTodo, MessageSquare } from 'lucide-react'
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
  readOnly?: boolean
  onClick?: () => void
  onAssign?: (userIds: number[]) => void
}

const priorityConfig = {
  0: { label: '无', variant: 'secondary' as const },
  1: { label: '低', variant: 'info' as const },
  2: { label: '中', variant: 'warning' as const },
  3: { label: '高', variant: 'danger' as const },
  4: { label: '紧急', variant: 'danger' as const },
}

export function KanbanCard({ task, members, isDragOverlay, readOnly = false, onClick, onAssign }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: readOnly })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const priority = priorityConfig[task.priority as keyof typeof priorityConfig] || priorityConfig[0]

  const isOverdue = !!task.due_date && !task.is_completed && new Date(task.due_date) < new Date()
  const isDueSoon =
    !!task.due_date &&
    !task.is_completed &&
    !isOverdue &&
    new Date(task.due_date).getTime() - Date.now() <= 24 * 60 * 60 * 1000

  const subtaskProgress =
    task.subtask_count > 0
      ? Math.round(((task.subtask_done || 0) / task.subtask_count) * 100)
      : 0

  return (
    <Card
      ref={setNodeRef}
      style={style}
      hover={false}
      className={cn(
        'relative group kanban-card-edge p-3 rounded-lg border border-border bg-card text-card-foreground',
        !isDragOverlay && !isDragging && 'cursor-pointer transition-shadow duration-150',
        isDragging && 'opacity-40',
        isDragOverlay && 'shadow-xl rotate-1 scale-[1.02] cursor-grabbing'
      )}
    >
      {/* Drag handle */}
      {!isDragOverlay && !readOnly && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="拖动排序"
          aria-roledescription=" draggable"
          onClick={(e) => e.stopPropagation()}
          className="absolute -left-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md transition-opacity"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      <div
        className="space-y-2"
        onClick={() => {
          if (!isDragging && onClick) onClick()
        }}
      >
        {/* Header: priority + relative time */}
        <div className="flex items-center justify-between gap-2">
          <Badge variant={priority.variant} className="gap-1 text-[10px] h-5 px-1.5">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
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
              <ListTodo className="h-3 w-3" aria-hidden="true" />
              <span className="tnum">{task.subtask_done || 0}/{task.subtask_count}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${subtaskProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Meta footer */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {onAssign && !isDragOverlay && !readOnly ? (
            <AssigneePicker
              members={members}
              value={task.assignees.map((a) => a.id)}
              onChange={onAssign}
              size="sm"
            />
          ) : task.assignees.length > 0 ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="flex -space-x-1.5">
                {task.assignees.slice(0, 3).map((a) => (
                  <Avatar key={a.id} name={a.display_name} src={a.avatar_url} size="sm" className="ring-1 ring-background" />
                ))}
              </div>
              <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                {task.assignees[0].display_name}
                {task.assignees.length > 1 && ` +${task.assignees.length - 1}`}
              </span>
            </div>
          ) : null}

          {task.due_date && (
            <span
              className={cn(
                'tnum flex items-center gap-1 text-xs shrink-0',
                isOverdue
                  ? 'text-danger font-medium'
                  : isDueSoon
                    ? 'text-warning font-medium'
                    : 'text-muted-foreground'
              )}
            >
              <Clock className="h-3 w-3" aria-hidden="true" />
              {isOverdue && <span>已逾期</span>}
              {new Date(task.due_date).toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </div>

        {task.comment_count > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            <span className="tnum">{task.comment_count}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
