import { useState } from 'react'
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
import { ProjectColorPicker } from './ProjectColorPicker'

interface Props {
  onClose: () => void
  onCreate: (data: { name: string; description: string; color: string }) => Promise<void> | void
}

const DEFAULT_COLOR = '#6366F1'

export function CreateProjectDialog({ onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
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
    <Dialog open onClose={submitting ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle showClose onClose={submitting ? undefined : onClose}>新建项目</DialogTitle>
          <DialogDescription>创建一个新项目来组织任务和知识库。</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">项目名称 *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称"
              required
              autoFocus
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">描述</label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目描述（可选）"
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">颜色</label>
            <ProjectColorPicker value={color} onChange={setColor} disabled={submitting} projectName={name} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" disabled={submitting || !name.trim()} loading={submitting}>
            创建项目
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
