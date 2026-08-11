import { useState, useEffect, useRef } from 'react'
import { CheckSquare, CircleUserRound, Flag, ListPlus, Plus, SlidersHorizontal, Sparkles, Square, WandSparkles } from 'lucide-react'
import api, { errDetail } from '../../utils/api'
import toast from 'react-hot-toast'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Select } from '../ui/Select'
import { AssigneePicker } from './AssigneePicker'
import { MilestonePicker } from '../milestones/MilestonePicker'
import type { StatusOption, MemberOption, GeneratedTask, Milestone } from '../../types'
import { cn } from '../../utils/cn'
import { useTaskReferenceAutocomplete } from '../../hooks/useTaskReferenceAutocomplete'
import { TaskReferenceMenu } from './TaskReferenceMenu'

interface Props {
  statuses: StatusOption[]
  defaultStatusId: number | null
  projectId: number
  milestones: Milestone[]
  onClose: () => void
  onCreate: (data: {
    title: string
    description: string
    status_id: number
    priority: number
    assignee_ids?: number[]
    due_date?: string | null
    milestone_ids?: number[]
  }) => Promise<void> | void
}

export function CreateTaskDialog({ statuses, defaultStatusId, projectId, milestones, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [statusId, setStatusId] = useState(defaultStatusId || statuses[0]?.id || 0)
  const [priority, setPriority] = useState(0)
  const [assigneeIds, setAssigneeIds] = useState<number[]>([])
  const [dueDate, setDueDate] = useState('')
  const [milestoneIds, setMilestoneIds] = useState<number[]>([])
  const [members, setMembers] = useState<MemberOption[]>([])
  const [llmOpen, setLlmOpen] = useState(false)
  const [llmInstruction, setLlmInstruction] = useState('')
  const [llmLoading, setLlmLoading] = useState(false)
  const [generatedTasks, setGeneratedTasks] = useState<GeneratedTask[]>([])
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [manualSubmitting, setManualSubmitting] = useState(false)
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null)
  const taskReference = useTaskReferenceAutocomplete({
    projectId,
    value: description,
    onChange: setDescription,
    inputRef: descriptionRef,
  })

  useEffect(() => {
    api.get(`/projects/${projectId}/members`).then((res) => setMembers(res.data)).catch(() => {})
  }, [projectId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || manualSubmitting) return
    setManualSubmitting(true)
    try {
      await onCreate({
        title: title.trim(),
        description,
        status_id: statusId,
        priority,
        assignee_ids: assigneeIds,
        due_date: dueDate ? new Date(`${dueDate}T23:59:59.999`).toISOString() : null,
        milestone_ids: milestoneIds,
      })
      toast.success('任务已创建')
      onClose()
    } catch (err: any) {
      toast.error(errDetail(err, '创建任务失败'))
    } finally {
      setManualSubmitting(false)
    }
  }

  const handleLLMGenerate = async () => {
    if (!llmInstruction.trim()) return
    setLlmLoading(true)
    setGeneratedTasks([])
    setSelectedTasks(new Set())
    try {
      const res = await api.post(
        '/llm/generate-tasks',
        {
          project_id: projectId,
          instruction: llmInstruction.trim(),
        },
        // LLM generation is slow; cap the wait so the button never spins forever
        // if the gateway or provider hangs (nginx allows up to 300s upstream).
        { timeout: 310000 }
      )
      const tasks: GeneratedTask[] = res.data
      if (!Array.isArray(tasks) || tasks.length === 0) {
        toast.error('LLM 未生成有效任务，请尝试更具体的描述')
        return
      }
      setGeneratedTasks(tasks)
      setSelectedTasks(new Set(tasks.map((_, i) => i)))
    } catch (err: any) {
      const isTimeout = err?.code === 'ECONNABORTED' || err?.response?.status === 504
      toast.error(
        isTimeout
          ? 'LLM 生成超时，请简化描述后重试'
          : '任务生成失败，请检查 LLM 配置或稍后重试'
      )
    } finally {
      setLlmLoading(false)
    }
  }

  const handleBatchCreate = async () => {
    if (selectedTasks.size === 0) return
    setCreating(true)
    let created = 0
    const failedIndexes: number[] = []
    for (const i of selectedTasks) {
      try {
        const task = generatedTasks[i]
        await onCreate({
          title: task.title,
          description: task.description || '',
          status_id: statusId,
          priority: task.priority || 0,
        })
        created++
      } catch {
        failedIndexes.push(i)
      }
    }
    setCreating(false)
    if (failedIndexes.length === 0 && created > 0) {
      toast.success(`已创建 ${created} 个任务`)
      onClose()
    } else if (created > 0) {
      setSelectedTasks(new Set(failedIndexes))
      toast.error(`已创建 ${created} 个任务，${failedIndexes.length} 个失败`)
    } else {
      toast.error('创建任务失败')
    }
  }

  const toggleTask = (i: number) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedTasks.size === generatedTasks.length) {
      setSelectedTasks(new Set())
    } else {
      setSelectedTasks(new Set(generatedTasks.map((_, i) => i)))
    }
  }

  const isBusy = creating || manualSubmitting

  return (
    <Dialog open onClose={isBusy ? () => {} : onClose} className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-hidden">
      <form onSubmit={handleSubmit} className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader className="relative flex-none overflow-hidden px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
          <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
          <DialogTitle showClose onClose={isBusy ? undefined : onClose} className="text-xl leading-tight">
            <span className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary text-primary-foreground">
                <ListPlus className="h-4 w-4" aria-hidden="true" />
              </span>
              新建任务
            </span>
          </DialogTitle>
          <DialogDescription className="pl-[46px]">任务定义与智能拆解</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
          <div className="mb-6 grid grid-cols-2 rounded-[8px] bg-muted p-1" role="tablist" aria-label="创建方式">
            <button
              type="button"
              role="tab"
              aria-selected={!llmOpen}
              onClick={() => setLlmOpen(false)}
              className={cn(
                'flex h-10 items-center justify-center gap-2 rounded-md text-sm font-medium transition-[background-color,color,box-shadow]',
                !llmOpen ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <CheckSquare className="h-4 w-4" aria-hidden="true" />
              手动创建
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={llmOpen}
              onClick={() => setLlmOpen(true)}
              className={cn(
                'flex h-10 items-center justify-center gap-2 rounded-md text-sm font-medium transition-[background-color,color,box-shadow]',
                llmOpen ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              AI 拆解
            </button>
          </div>

          {llmOpen ? (
            <section className="overflow-hidden rounded-[8px] border border-primary/20 bg-primary/[0.025]">
              <div className="flex items-center gap-3 border-b border-primary/15 px-5 py-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
                  <WandSparkles className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">智能任务拆解</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">基于目标生成可执行任务</p>
                </div>
              </div>
              <div className="space-y-4 p-5">
                <Textarea
                  rows={5}
                  value={llmInstruction}
                  onChange={(e) => setLlmInstruction(e.target.value)}
                  placeholder="描述目标、范围与交付要求"
                  disabled={llmLoading || isBusy}
                  autoFocus
                  className="min-h-32 bg-background text-sm leading-6"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={handleLLMGenerate}
                    disabled={llmLoading || !llmInstruction.trim() || isBusy}
                    loading={llmLoading}
                  >
                    {!llmLoading && <Sparkles className="h-4 w-4" aria-hidden="true" />}
                    生成任务
                  </Button>
                </div>

                {generatedTasks.length > 0 && (
                  <div className="border-y border-border bg-card">
                    <div className="flex items-center justify-between border-b border-border px-4 py-3">
                      <span className="text-xs font-medium text-muted-foreground">生成结果 · {generatedTasks.length}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
                        {selectedTasks.size === generatedTasks.length ? '取消全选' : '全选'}
                      </Button>
                    </div>
                    <div className="max-h-64 divide-y divide-border overflow-y-auto">
                      {generatedTasks.map((task, i) => (
                        <button
                          key={i}
                          type="button"
                          aria-pressed={selectedTasks.has(i)}
                          onClick={() => toggleTask(i)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
                        >
                          {selectedTasks.has(i) ? (
                            <CheckSquare className="mt-0.5 h-4 w-4 flex-none text-primary" />
                          ) : (
                            <Square className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground">{task.title}</span>
                            {task.description && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-end border-t border-border p-3">
                      <Button type="button" onClick={handleBatchCreate} disabled={creating || selectedTasks.size === 0} loading={creating}>
                        {!creating && <Plus className="h-4 w-4" aria-hidden="true" />}
                        创建所选任务 · {selectedTasks.size}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <div className="space-y-6">
              <section className="grid gap-4 border-b border-border pb-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
                <div>
                  <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground"><CheckSquare className="h-4 w-4" /></span>
                  <label htmlFor="create-task-title" className="text-sm font-semibold">任务内容</label>
                </div>
                <div className="space-y-3">
                  <Input id="create-task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="输入任务标题" required autoFocus disabled={isBusy} className="h-11 text-base" />
                  <div className="relative">
                    <Textarea
                      ref={descriptionRef}
                      rows={4}
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value)
                        taskReference.updateQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)
                      }}
                      onKeyDown={(e) => { taskReference.handleKeyDown(e) }}
                      onBlur={taskReference.close}
                      placeholder="补充任务背景与验收标准，输入 # 可引用任务"
                      disabled={isBusy}
                      className="min-h-28 leading-6"
                    />
                    {taskReference.open && (
                      <TaskReferenceMenu
                        tasks={taskReference.candidates}
                        activeIndex={taskReference.activeIndex}
                        onChoose={taskReference.choose}
                        onActiveIndexChange={taskReference.setActiveIndex}
                        className="left-0 top-full mt-1"
                      />
                    )}
                  </div>
                </div>
              </section>

              <section className="grid gap-4 border-b border-border pb-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
                <div>
                  <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground"><SlidersHorizontal className="h-4 w-4" /></span>
                  <h3 className="text-sm font-semibold">执行属性</h3>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="space-y-2 text-xs font-medium text-muted-foreground">状态<Select value={statusId} onChange={(e) => setStatusId(parseInt(e.target.value))} disabled={isBusy}>{statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</Select></label>
                  <label className="space-y-2 text-xs font-medium text-muted-foreground">优先级<Select value={priority} onChange={(e) => setPriority(parseInt(e.target.value))} disabled={isBusy}><option value={0}>无</option><option value={1}>低</option><option value={2}>中</option><option value={3}>高</option><option value={4}>紧急</option></Select></label>
                  <label className="space-y-2 text-xs font-medium text-muted-foreground">截止日期<Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={isBusy} /></label>
                </div>
              </section>

              <section className="grid gap-4 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
                <div>
                  <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground"><CircleUserRound className="h-4 w-4" /></span>
                  <h3 className="text-sm font-semibold">协作成员</h3>
                </div>
                <AssigneePicker members={members} value={assigneeIds} onChange={setAssigneeIds} disabled={isBusy} />
              </section>

              <section className="grid gap-4 border-t border-border pt-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
                <div>
                  <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground"><Flag className="h-4 w-4" /></span>
                  <h3 className="text-sm font-semibold">交付节点</h3>
                </div>
                <MilestonePicker milestones={milestones} value={milestoneIds} onChange={setMilestoneIds} disabled={isBusy} />
              </section>
            </div>
          )}
        </div>

        <DialogFooter className="flex-none px-5 sm:px-7">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isBusy}>取消</Button>
          {!llmOpen && (
            <Button type="submit" disabled={isBusy || !title.trim()} loading={manualSubmitting}>
              {!manualSubmitting && <Plus className="h-4 w-4" aria-hidden="true" />}
              创建任务
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  )
}
