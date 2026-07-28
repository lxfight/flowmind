import { useMemo, useState } from 'react'
import { CalendarDays, Check, Flag, Search, UserRound } from 'lucide-react'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'
import { cn } from '../../utils/cn'
import type {
  MemberOption,
  Milestone,
  MilestoneInput,
  MilestoneStatus,
  TaskSummary,
} from '../../types'

interface MilestoneDialogProps {
  open: boolean
  milestone?: Milestone | null
  members: MemberOption[]
  tasks: TaskSummary[]
  saving: boolean
  onClose: () => void
  onSubmit: (input: MilestoneInput) => Promise<void>
}

function initialDate() {
  const date = new Date()
  date.setDate(date.getDate() + 14)
  return date.toISOString().slice(0, 10)
}

export function MilestoneDialog({
  open,
  milestone,
  ...props
}: MilestoneDialogProps) {
  if (!open) return null
  return (
    <MilestoneDialogForm
      key={milestone?.id ?? 'new'}
      milestone={milestone}
      {...props}
    />
  )
}

type MilestoneDialogFormProps = Omit<MilestoneDialogProps, 'open'>

function MilestoneDialogForm({
  milestone,
  members,
  tasks,
  saving,
  onClose,
  onSubmit,
}: MilestoneDialogFormProps) {
  const [title, setTitle] = useState(milestone?.title ?? '')
  const [description, setDescription] = useState(milestone?.description ?? '')
  const [targetDate, setTargetDate] = useState(() => milestone?.target_date ?? initialDate())
  const [ownerId, setOwnerId] = useState<number | null>(milestone?.owner_id ?? null)
  const [status, setStatus] = useState<MilestoneStatus>(milestone?.status ?? 'open')
  const [taskIds, setTaskIds] = useState<number[]>(milestone?.task_ids ?? [])
  const [taskQuery, setTaskQuery] = useState('')

  const visibleTasks = useMemo(() => {
    const query = taskQuery.trim().toLocaleLowerCase()
    if (!query) return tasks
    return tasks.filter((task) =>
      `${task.title} ${task.description}`.toLocaleLowerCase().includes(query),
    )
  }, [taskQuery, tasks])

  const toggleTask = (taskId: number) => {
    setTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    )
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !targetDate) return
    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      target_date: targetDate,
      owner_id: ownerId,
      task_ids: taskIds,
      ...(milestone ? { status } : {}),
    })
  }

  return (
    <Dialog open onClose={onClose} className="max-w-3xl overflow-hidden">
      <form onSubmit={handleSubmit}>
        <DialogHeader className="relative overflow-hidden">
          <div className="absolute right-8 top-3 select-none text-[84px] font-black leading-none text-foreground/[0.035]" aria-hidden="true">
            M
          </div>
          <DialogTitle showClose onClose={onClose} className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-primary" />
            {milestone ? '编辑里程碑' : '建立里程碑'}
          </DialogTitle>
          <DialogDescription>
            定义交付时间、负责人和需要共同抵达的任务集合。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[68vh] overflow-y-auto px-6 py-6 scrollbar-thin">
          <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]">
            <div className="space-y-5">
              <label className="block space-y-2 text-xs font-semibold text-muted-foreground">
                里程碑名称
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="例如：公开测试版"
                  maxLength={256}
                  autoFocus
                  required
                  className="h-11 text-base text-foreground"
                />
              </label>

              <label className="block space-y-2 text-xs font-semibold text-muted-foreground">
                验收说明
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="记录交付边界、结果和依赖"
                  rows={5}
                  className="min-h-32 resize-none leading-6 text-foreground"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-xs font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />目标日期
                  </span>
                  <Input
                    type="date"
                    value={targetDate}
                    onChange={(event) => setTargetDate(event.target.value)}
                    required
                  />
                </label>
                <label className="space-y-2 text-xs font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5" />负责人
                  </span>
                  <Select
                    value={ownerId ?? ''}
                    onChange={(event) =>
                      setOwnerId(event.target.value ? Number(event.target.value) : null)
                    }
                  >
                    <option value="">暂不指定</option>
                    {members.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.display_name || member.username}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              {milestone && (
                <label className="block space-y-2 text-xs font-semibold text-muted-foreground">
                  当前状态
                  <Select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as MilestoneStatus)}
                  >
                    <option value="open">推进中</option>
                    <option value="completed">已完成</option>
                    <option value="cancelled">已取消</option>
                  </Select>
                </label>
              )}
            </div>

            <section className="border-l-0 border-border md:border-l md:pl-6" aria-label="关联任务">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">关联任务</h3>
                  <p className="mt-1 text-xs text-muted-foreground">已选择 {taskIds.length} 项</p>
                </div>
                {taskIds.length > 0 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:text-primary-hover"
                    onClick={() => setTaskIds([])}
                  >
                    清空
                  </button>
                )}
              </div>

              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={taskQuery}
                  onChange={(event) => setTaskQuery(event.target.value)}
                  placeholder="搜索顶层任务"
                  className="pl-9"
                />
              </div>

              <div className="max-h-[21rem] divide-y divide-border overflow-y-auto border-y border-border scrollbar-thin">
                {visibleTasks.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">没有匹配的任务</p>
                ) : (
                  visibleTasks.map((task) => {
                    const selected = taskIds.includes(task.id)
                    return (
                      <button
                        key={task.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleTask(task.id)}
                        className={cn(
                          'flex min-h-12 w-full items-start gap-3 px-2 py-3 text-left transition-colors hover:bg-accent/60',
                          selected && 'bg-primary/[0.06]',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-4 w-4 flex-none items-center justify-center border',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input bg-background',
                          )}
                        >
                          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0">
                          <span className={cn('block text-sm leading-5 text-foreground', task.is_completed && 'line-through text-muted-foreground')}>
                            {task.title}
                          </span>
                          {task.assignees.length > 0 && (
                            <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                              {task.assignees.map((assignee) => assignee.display_name).join('、')}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </section>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" loading={saving} disabled={!title.trim() || !targetDate}>
            {!saving && <Flag className="h-4 w-4" />}
            {milestone ? '保存变更' : '建立节点'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
