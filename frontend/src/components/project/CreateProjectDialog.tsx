import { useState } from 'react'
import { X } from 'lucide-react'
import { AnimatedDialog } from '../common/AnimatedDialog'

interface Props {
  onClose: () => void
  onCreate: (data: { name: string; description: string; color: string }) => void
}

const COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6']

export function CreateProjectDialog({ onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onCreate({ name: name.trim(), description, color })
    onClose()
  }

  return (
    <AnimatedDialog open onClose={onClose} className="card p-6 w-full max-w-md dark:bg-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold dark:text-gray-100">新建项目</h3>
        <button onClick={onClose} className="btn-ghost p-1"><X size={18} /></button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">项目名称 *</label>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="输入项目名称" required autoFocus />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">描述</label>
          <textarea className="input-field resize-none" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="项目描述（可选）" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">颜色</label>
          <div className="flex gap-2">
            {COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-300 scale-110' : ''}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="btn-primary">创建</button>
        </div>
      </form>
    </AnimatedDialog>
  )
}
