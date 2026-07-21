import { useEffect, useState } from 'react'
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
import { Switch } from '../ui/Switch'
import api, { errDetail } from '../../utils/api'
import toast from 'react-hot-toast'
import { cn } from '../../utils/cn'
import type { Project } from '../../stores/projectStore'

interface Props {
  project: Project
  onClose: () => void
  onUpdated: (updated: Project) => void
}

const COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6']

export function EditProjectDialog({ project, onClose, onUpdated }: Props) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || '')
  const [color, setColor] = useState(project.color)
  const [isArchived, setIsArchived] = useState(project.is_archived)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form fields when the edited project prop changes
    setName(project.name)
    setDescription(project.description || '')
    setColor(project.color)
    setIsArchived(project.is_archived)
  }, [project])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const res = await api.put(`/projects/${project.id}`, {
        name: name.trim(),
        description,
        color,
        is_archived: isArchived,
      })
      toast.success('项目已更新')
      onUpdated(res.data)
      onClose()
    } catch (err: any) {
      toast.error(errDetail(err, '更新项目失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle showClose onClose={saving ? undefined : onClose}>编辑项目</DialogTitle>
          <DialogDescription>修改项目名称、描述、颜色或归档状态。</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">项目名称 *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称"
              required
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">描述</label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目描述（可选）"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">颜色</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  disabled={saving}
                  aria-label={`选择颜色 ${c}`}
                  aria-pressed={color === c}
                  className={cn(
                    'w-8 h-8 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    color === c && 'ring-2 ring-offset-2 ring-foreground scale-110'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">归档项目</p>
              <p className="text-xs text-muted-foreground">归档后项目不会出现在首页项目列表中，可通过项目链接再次访问和取消归档。</p>
            </div>
            <Switch
              checked={isArchived}
              onCheckedChange={setIsArchived}
              disabled={saving}
              aria-label="归档项目"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" disabled={saving || !name.trim()} loading={saving}>
            保存
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
