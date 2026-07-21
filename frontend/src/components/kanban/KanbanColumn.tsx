import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { motion } from 'framer-motion'
import { KanbanCard } from './KanbanCard'
import { Plus } from 'lucide-react'
import { Card, CardContent, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { cn } from '../../utils/cn'
import type { TaskStatus, TaskCard, MemberOption } from '../../types'

interface Props {
  status: Pick<TaskStatus, 'id' | 'name' | 'color' | 'task_count'>
  tasks: TaskCard[]
  members: MemberOption[]
  readOnly?: boolean
  /** Column width in px on desktop (mobile stays full-width) */
  columnWidth?: number
  onColumnResizeStart?: (e: React.PointerEvent) => void
  onAddTask: () => void
  onTaskClick: (taskId: number) => void
  onAssignTask?: (taskId: number, userIds: number[]) => void
}

export function KanbanColumn({ status, tasks, members, readOnly = false, columnWidth, onColumnResizeStart, onAddTask, onTaskClick, onAssignTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `status-${status.id}`,
    disabled: readOnly,
  })

  return (
    <Card
      className={cn(
        'relative flex-shrink-0 w-full lg:w-[var(--kanban-col-w)] flex flex-col',
        isOver && 'ring-2 ring-primary bg-primary/5 dark:bg-primary/10'
      )}
      style={columnWidth ? ({ '--kanban-col-w': `${columnWidth}px` } as React.CSSProperties) : undefined}
    >
      <CardHeader className="sticky top-0 z-10 rounded-t-xl bg-card px-3 py-3 flex-row items-center justify-between gap-2 space-y-0 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2.5 w-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: status.color }}
          />
          <h4 className="truncate text-sm font-semibold tracking-tight text-foreground">{status.name}</h4>
          <Badge variant="secondary" className="h-5 px-1.5 text-xs tnum">{tasks.length}</Badge>
        </div>
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={onAddTask}
            aria-label={`在 ${status.name} 列添加任务`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="flex-1 px-2 pb-3 pt-0">
        <div
          ref={setNodeRef}
          className="flex min-h-[60px] flex-col gap-2"
        >
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {tasks.map((task) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <KanbanCard
                  task={task}
                  members={members}
                  readOnly={readOnly}
                  onClick={() => onTaskClick(task.id)}
                  onAssign={onAssignTask ? (userIds) => onAssignTask(task.id, userIds) : undefined}
                />
              </motion.div>
            ))}
          </SortableContext>

          {tasks.length === 0 && (
            <EmptyState
              title="暂无任务"
              description={readOnly ? '该状态列下没有任务' : '点击 + 按钮或拖拽任务到此处'}
              className="bg-transparent border-none shadow-none"
            />
          )}
        </div>
      </CardContent>

      {onColumnResizeStart && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`调整 ${status.name} 列宽度`}
          title="拖拽调整列宽"
          onPointerDown={onColumnResizeStart}
          className="absolute -right-2 top-0 z-20 hidden lg:block h-full w-2 cursor-col-resize rounded-full transition-colors hover:bg-primary/30 active:bg-primary/50"
          style={{ touchAction: 'none' }}
        />
      )}
    </Card>
  )
}
