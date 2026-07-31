import { CheckCircle2, Circle, ListTodo } from 'lucide-react'
import { cn } from '../../utils/cn'
import type { TaskReferenceTask } from '../../types'

interface Props {
  tasks: TaskReferenceTask[]
  activeIndex: number
  onChoose: (task: TaskReferenceTask) => void
  onActiveIndexChange?: (index: number) => void
  className?: string
}

export function TaskReferenceMenu({ tasks, activeIndex, onChoose, onActiveIndexChange, className }: Props) {
  if (tasks.length === 0) return null
  return (
    <div
      role="listbox"
      aria-label="引用任务"
      className={cn(
        'absolute z-30 w-80 max-w-[calc(100vw-3rem)] overflow-hidden rounded-[8px] border border-border bg-popover shadow-lg',
        className,
      )}
    >
      {tasks.map((task, index) => (
        <button
          key={task.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => {
            event.preventDefault()
            onChoose(task)
          }}
          onMouseEnter={() => onActiveIndexChange?.(index)}
          className={cn(
            'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors',
            index === activeIndex && 'bg-accent',
          )}
        >
          {task.is_completed ? (
            <CheckCircle2 className="h-4 w-4 flex-none text-success" />
          ) : (
            <Circle className="h-4 w-4 flex-none text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{task.title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="tnum">#{task.id}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 truncate">
                <ListTodo className="h-3 w-3" />{task.status_name}
              </span>
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
