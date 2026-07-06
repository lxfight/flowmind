import { useState, useEffect } from 'react'
import { X, Sparkles, Loader2, CheckSquare, Square } from 'lucide-react'
import api from '../../utils/api'
import toast from 'react-hot-toast'

interface Status {
  id: number
  name: string
}

interface Member {
  id: number
  user_id: number
  display_name: string
  username: string
}

interface GeneratedTask {
  title: string
  description: string
  priority: number
}

interface Props {
  statuses: Status[]
  defaultStatusId: number | null
  projectId: number
  onClose: () => void
  onCreate: (data: {
    title: string
    description: string
    status_id: number
    priority: number
    assignee_id?: number | null
  }) => void
}

export function CreateTaskDialog({ statuses, defaultStatusId, projectId, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [statusId, setStatusId] = useState(defaultStatusId || statuses[0]?.id || 0)
  const [priority, setPriority] = useState(0)
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [llmOpen, setLlmOpen] = useState(false)
  const [llmInstruction, setLlmInstruction] = useState('')
  const [llmLoading, setLlmLoading] = useState(false)
  const [generatedTasks, setGeneratedTasks] = useState<GeneratedTask[]>([])
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api.get(`/projects/${projectId}/members`).then((res) => setMembers(res.data)).catch(() => {})
  }, [projectId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onCreate({ title: title.trim(), description, status_id: statusId, priority, assignee_id: assigneeId })
    onClose()
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
    for (const i of selectedTasks) {
      try {
        const task = generatedTasks[i]
        await api.post(`/projects/${projectId}/tasks`, {
          title: task.title,
          description: task.description || '',
          status_id: statusId,
          priority: task.priority || 0,
        })
        created++
      } catch {
        // continue with remaining tasks
      }
    }
    setCreating(false)
    if (created > 0) {
      toast.success(`已创建 ${created} 个任务`)
      onClose()
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

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">新建任务</h3>
          <button onClick={onClose} className="btn-ghost p-1">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* LLM Quick Create */}
          {!llmOpen ? (
            <button
              className="w-full mb-4 px-4 py-3 bg-gradient-to-r from-primary-50 to-indigo-50 border border-primary-200 rounded-lg text-sm text-primary-700 flex items-center gap-2 hover:from-primary-100 transition-colors"
              onClick={() => setLlmOpen(true)}
            >
              <Sparkles size={16} />
              <span>用自然语言让 LLM 帮你创建任务 — "下周完成用户登录模块"</span>
            </button>
          ) : (
            <div className="mb-4 p-3 bg-primary-50 rounded-lg">
              <textarea
                className="w-full text-sm bg-white rounded-lg p-2 border focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
                rows={2}
                placeholder="描述你要创建的任务..."
                value={llmInstruction}
                onChange={(e) => setLlmInstruction(e.target.value)}
                disabled={llmLoading}
              />
              <div className="flex items-center justify-between mt-2">
                <button
                  className="text-xs text-gray-500 hover:text-gray-700"
                  onClick={() => { setLlmOpen(false); setGeneratedTasks([]); setSelectedTasks(new Set()) }}
                  disabled={llmLoading}
                >
                  手动创建
                </button>
                <button
                  className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
                  onClick={handleLLMGenerate}
                  disabled={llmLoading || !llmInstruction.trim()}
                >
                  {llmLoading && <Loader2 size={12} className="animate-spin" />}
                  {llmLoading ? '生成中...' : 'LLM 生成'}
                </button>
              </div>

              {/* Generated Tasks */}
              {generatedTasks.length > 0 && (
                <div className="mt-3 bg-white rounded-lg border p-2 max-h-48 overflow-y-auto">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-xs font-medium text-gray-500">
                      {generatedTasks.length} 个任务
                    </span>
                    <button
                      className="text-xs text-primary-600 hover:underline"
                      onClick={toggleAll}
                    >
                      {selectedTasks.size === generatedTasks.length ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {generatedTasks.map((task, i) => (
                      <label
                        key={i}
                        className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer"
                      >
                        <button
                          className="mt-0.5 flex-shrink-0 text-primary-500"
                          onClick={() => toggleTask(i)}
                        >
                          {selectedTasks.has(i) ? (
                            <CheckSquare size={14} />
                          ) : (
                            <Square size={14} />
                          )}
                        </button>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-gray-400 truncate">{task.description}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  <button
                    className="btn-primary w-full text-xs py-1.5 mt-2 flex items-center justify-center gap-1"
                    onClick={handleBatchCreate}
                    disabled={creating || selectedTasks.size === 0}
                  >
                    {creating && <Loader2 size={12} className="animate-spin" />}
                    {creating ? '创建中...' : `创建选中任务 (${selectedTasks.size})`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Manual form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">任务标题 *</label>
              <input
                className="input-field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入任务标题"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">描述</label>
              <textarea
                className="input-field resize-none"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="可选的任务描述"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">状态</label>
                <select
                  className="input-field"
                  value={statusId}
                  onChange={(e) => setStatusId(parseInt(e.target.value))}
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label className="block text-sm font-medium mb-1">优先级</label>
                <select
                  className="input-field"
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value))}
                >
                  <option value={0}>无</option>
                  <option value={1}>低</option>
                  <option value={2}>中</option>
                  <option value={3}>高</option>
                  <option value={4}>紧急</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">指派人</label>
              <select
                className="input-field"
                value={assigneeId || ''}
                onChange={(e) => setAssigneeId(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">不指定</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name || m.username}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="btn-primary">
                创建
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
