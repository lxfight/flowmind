import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { KanbanCard } from './KanbanCard'
import { Plus } from 'lucide-react'
import type { TaskStatus, TaskCard } from '../../types'

interface Props {
  status: Pick<TaskStatus, 'id' | 'name' | 'color' | 'task_count'>
  tasks: TaskCard[]
  onAddTask: () => void
  onTaskClick: (taskId: number) => void
}

export function KanbanColumn({ status, tasks, onAddTask, onTaskClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `status-${status.id}`,
  })

  return (
    <div
      className={`flex-shrink-0 w-72 bg-gray-100 dark:bg-gray-800 rounded-xl flex flex-col ${
        isOver ? 'ring-2 ring-primary-400 dark:ring-primary-500 bg-primary-50 dark:bg-primary-900/30' : ''
      }`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: status.color }}
          />
          <h4 className="font-medium text-sm text-gray-700 dark:text-gray-200">{status.name}</h4>
          <span className="text-xs text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-700 px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        <button onClick={onAddTask} className="btn-ghost p-1">
          <Plus size={14} />
        </button>
      </div>

      {/* Tasks */}
      <div ref={setNodeRef} className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto min-h-[60px]">
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <KanbanCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="text-center text-sm text-gray-400 dark:text-gray-500 py-8">
            暂无任务
          </div>
        )}
      </div>
    </div>
  )
}
