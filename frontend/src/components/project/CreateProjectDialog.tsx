import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { AnimatedDialog } from '../common/AnimatedDialog'

interface Props {
  onClose: () => void
  onCreate: (data: { name: string; description: string; color: string }) => Promise<void> | void
}

const COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6']

export function CreateProjectDialog({ onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    try {
      await onCreate({ name: name.trim(), description, color })
      onClose()
    } catch {
      // Parent owns the user-facing error toast.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatedDialog open onClose={submitting ? undefined : onClose} className="card p-6 w-full max-w-md dark:bg-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold dark:text-gray-100">新建项目</h3>
        <button onClick={onClose} className="btn-ghost p-1" disabled={submitting}><X size={18} /></button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">项目名称 *</label>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="输入项目名称" required autoFocus disabled={submitting} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">描述</label>
          <textarea className="input-field resize-none" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="项目描述（可选）" disabled={submitting} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">颜色</label>
          <div className="flex gap-2">
            {COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)} disabled={submitting}
                className={`w-8 h-8 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-300 scale-110' : ''}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>取消</button>
          <button type="submit" className="btn-primary flex items-center gap-1.5" disabled={submitting || !name.trim()}>
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? '创建中...' : '创建'}
          </button>
        </div>
      </form>
    </AnimatedDialog>
  )
}
