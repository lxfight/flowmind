import { useState } from 'react'
import { CheckSquare, Square } from 'lucide-react'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { Badge } from '../ui/Badge'
import type { GeneratedTask, StatusOption } from '../../types'

interface Props {
  tasks: GeneratedTask[]
  statuses: StatusOption[]
  defaultStatusId: number | null
  projectId: number
  onClose: () => void
  onCreate: (data: {
    title: string
    description: string
    status_id: number
    priority: number
  }) => Promise<void> | void
}

export function BatchCreateTasksDialog({
  tasks,
  statuses,
  defaultStatusId,
  onClose,
  onCreate,
}: Props) {
  const [statusId, setStatusId] = useState(defaultStatusId || statuses[0]?.id || 0)
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(
    new Set(tasks.map((_, i) => i))
  )
  const [creating, setCreating] = useState(false)

  const toggleTask = (i: number) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedTasks.size === tasks.length) {
      setSelectedTasks(new Set())
    } else {
      setSelectedTasks(new Set(tasks.map((_, i) => i)))
    }
  }

  const handleCreate = async () => {
    if (selectedTasks.size === 0) return
    setCreating(true)
    const failedIndexes: number[] = []
    for (const i of selectedTasks) {
      try {
        const task = tasks[i]
        await onCreate({
          title: task.title,
          description: task.description || '',
          status_id: statusId,
          priority: task.priority || 0,
        })
      } catch {
        failedIndexes.push(i)
      }
    }
    setCreating(false)
    if (failedIndexes.length === 0) {
      onClose()
    } else {
      setSelectedTasks(new Set(failedIndexes))
    }
  }

  return (
    <Dialog open onClose={creating ? () => {} : onClose}>
      <DialogHeader>
        <DialogTitle showClose={!creating} onClose={onClose}>LLM 生成的任务</DialogTitle>
        <DialogDescription>选择要创建的任务和状态列。</DialogDescription>
      </DialogHeader>

      <div className="px-6 pb-6 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">创建到状态列</label>
          <Select
            value={statusId}
            onChange={(e) => setStatusId(parseInt(e.target.value))}
            disabled={creating}
          >
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>共 {tasks.length} 个任务</span>
              <Badge variant="primary">已选 {selectedTasks.size}</Badge>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleAll}
              disabled={creating}
            >
              {selectedTasks.size === tasks.length ? '取消全选' : '全选'}
            </Button>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1 scrollbar-thin">
            {tasks.map((task, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleTask(i)}
                disabled={creating}
                className="w-full flex items-start gap-2 rounded-md p-2 text-left hover:bg-accent/50 transition-colors disabled:opacity-50"
              >
                <span className="mt-0.5 flex-shrink-0 text-primary">
                  {selectedTasks.has(i) ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  {task.description && (
                    <p className="text-xs text-muted-foreground truncate">{task.description}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={creating}>
          取消
        </Button>
        <Button
          onClick={handleCreate}
          disabled={creating || selectedTasks.size === 0}
          loading={creating}
        >
          创建 {selectedTasks.size} 个任务
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
