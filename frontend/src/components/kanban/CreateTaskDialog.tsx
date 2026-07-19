import { useState, useEffect } from 'react'
import { Sparkles, Loader2, CheckSquare, Square, Plus } from 'lucide-react'
import api from '../../utils/api'
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
import type { StatusOption, MemberOption, GeneratedTask } from '../../types'

interface Props {
  statuses: StatusOption[]
  defaultStatusId: number | null
  projectId: number
  onClose: () => void
  onCreate: (data: {
    title: string
    description: string
    status_id: number
    priority: number
    assignee_id?: number | null
  }) => Promise<void> | void
}

export function CreateTaskDialog({ statuses, defaultStatusId, projectId, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [statusId, setStatusId] = useState(defaultStatusId || statuses[0]?.id || 0)
  const [priority, setPriority] = useState(0)
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  const [members, setMembers] = useState<MemberOption[]>([])
  const [llmOpen, setLlmOpen] = useState(false)
  const [llmInstruction, setLlmInstruction] = useState('')
  const [llmLoading, setLlmLoading] = useState(false)
  const [generatedTasks, setGeneratedTasks] = useState<GeneratedTask[]>([])
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [manualSubmitting, setManualSubmitting] = useState(false)

  useEffect(() => {
    api.get(`/projects/${projectId}/members`).then((res) => setMembers(res.data)).catch(() => {})
  }, [projectId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || manualSubmitting) return
    setManualSubmitting(true)
    try {
      await onCreate({ title: title.trim(), description, status_id: statusId, priority, assignee_id: assigneeId })
      toast.success('任务已创建')
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '创建任务失败')
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
      const res = await api.post('/llm/generate-tasks', {
        project_id: projectId,
        instruction: llmInstruction.trim(),
      })
      const tasks: GeneratedTask[] = res.data
      if (!Array.isArray(tasks) || tasks.length === 0) {
        toast.error('LLM 未生成有效任务，请尝试更具体的描述')
        return
      }
      setGeneratedTasks(tasks)
      setSelectedTasks(new Set(tasks.map((_, i) => i)))
    } catch {
      toast.error('任务生成失败，请检查 LLM 配置或稍后重试')
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
    <Dialog open onClose={isBusy ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle showClose onClose={isBusy ? undefined : onClose}>新建任务</DialogTitle>
          <DialogDescription>手动创建，或用 LLM 根据描述批量生成任务。</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* LLM Quick Create */}
          {!llmOpen ? (
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 border-dashed"
              onClick={() => setLlmOpen(true)}
              disabled={isBusy}
            >
              <Sparkles className="h-4 w-4 text-primary" />
              用自然语言让 LLM 帮你创建任务
            </Button>
          ) : (
            <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-3">
              <Textarea
                rows={2}
                value={llmInstruction}
                onChange={(e) => setLlmInstruction(e.target.value)}
                placeholder="描述你要创建的任务..."
                disabled={llmLoading || isBusy}
              />
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setLlmOpen(false); setGeneratedTasks([]); setSelectedTasks(new Set()) }}
                  disabled={llmLoading}
                >
                  手动创建
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleLLMGenerate}
                  disabled={llmLoading || !llmInstruction.trim() || isBusy}
                  loading={llmLoading}
                >
                  LLM 生成
                </Button>
              </div>

              {generatedTasks.length > 0 && (
                <div className="rounded-md border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{generatedTasks.length} 个任务</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleAll}
                    >
                      {selectedTasks.size === generatedTasks.length ? '取消全选' : '全选'}
                    </Button>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {generatedTasks.map((task, i) => (
                      <label
                        key={i}
                        className="flex items-start gap-2 p-1.5 rounded hover:bg-accent cursor-pointer"
                      >
                        <button
                          type="button"
                          className="mt-0.5 flex-shrink-0 text-primary"
                          onClick={() => toggleTask(i)}
                        >
                          {selectedTasks.has(i) ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-muted-foreground truncate">{task.description}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={handleBatchCreate}
                    disabled={creating || selectedTasks.size === 0}
                    loading={creating}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    创建选中任务 ({selectedTasks.size})
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Manual form */}
          <div className="space-y-2">
            <label className="text-sm font-medium">任务标题 *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题"
              required
              autoFocus={!llmOpen}
              disabled={isBusy}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">描述</label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选的任务描述"
              disabled={isBusy}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">状态</label>
              <Select
                value={statusId}
                onChange={(e) => setStatusId(parseInt(e.target.value))}
                disabled={isBusy}
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">优先级</label>
              <Select
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value))}
                disabled={isBusy}
              >
                <option value={0}>无</option>
                <option value={1}>低</option>
                <option value={2}>中</option>
                <option value={3}>高</option>
                <option value={4}>紧急</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">指派人</label>
            <Select
              value={assigneeId || ''}
              onChange={(e) => setAssigneeId(e.target.value ? parseInt(e.target.value) : null)}
              disabled={isBusy}
            >
              <option value="">不指定</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name || m.username}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
            取消
          </Button>
          <Button type="submit" disabled={isBusy || !title.trim()} loading={manualSubmitting}>
            创建任务
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
