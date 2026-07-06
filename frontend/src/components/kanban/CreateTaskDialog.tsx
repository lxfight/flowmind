import { useState } from 'react'
import { X, Sparkles } from 'lucide-react'

interface Status {
  id: number
  name: string
}

interface Props {
  statuses: Status[]
  defaultStatusId: number | null
  onClose: () => void
  onCreate: (data: {
    title: string
    description: string
    status_id: number
    priority: number
  }) => void
}

export function CreateTaskDialog({ statuses, defaultStatusId, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [statusId, setStatusId] = useState(defaultStatusId || statuses[0]?.id || 0)
  const [priority, setPriority] = useState(0)
  const [llmOpen, setLlmOpen] = useState(false)
  const [llmInstruction, setLlmInstruction] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onCreate({ title: title.trim(), description, status_id: statusId, priority })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">新建任务</h3>
          <button onClick={onClose} className="btn-ghost p-1">
            <X size={18} />
          </button>
        </div>

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
            />
            <div className="flex items-center justify-between mt-2">
              <button
                className="text-xs text-gray-500 hover:text-gray-700"
                onClick={() => setLlmOpen(false)}
              >
                手动创建
              </button>
              <button className="btn-primary text-xs py-1.5 px-3">
                LLM 生成
              </button>
            </div>
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
  )
}
