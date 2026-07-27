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
import { ProjectColorPicker } from './ProjectColorPicker'
import type { Project } from '../../stores/projectStore'
import { AlignLeft, Archive, FolderPen, Palette, Save, Type } from 'lucide-react'

interface Props {
  project: Project
  onClose: () => void
  onUpdated: (updated: Project) => void
}

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
    <Dialog
      open
      onClose={saving ? () => {} : onClose}
      className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-hidden"
    >
      <form onSubmit={handleSubmit} className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader className="relative flex-none overflow-hidden border-b border-border px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
          <span
            className="absolute inset-y-0 left-0 w-1 transition-colors"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <DialogTitle showClose onClose={saving ? undefined : onClose} className="text-xl leading-tight">
            <span className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-[8px] text-white transition-colors"
                style={{ backgroundColor: color }}
              >
                <FolderPen className="h-4 w-4" aria-hidden="true" />
              </span>
              编辑项目
            </span>
          </DialogTitle>
          <DialogDescription className="pl-[46px]">项目信息与视觉标识</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-7">
          <section className="grid gap-4 border-b border-border py-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
            <div>
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
                <Type className="h-4 w-4" aria-hidden="true" />
              </span>
              <label htmlFor="edit-project-name" className="text-sm font-semibold text-foreground">
                项目名称
              </label>
              <p className="mt-1 text-xs text-muted-foreground">必填</p>
            </div>
            <Input
              id="edit-project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称"
              required
              disabled={saving}
              className="h-11 text-base"
            />
          </section>

          <section className="grid gap-4 border-b border-border py-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
            <div>
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
                <AlignLeft className="h-4 w-4" aria-hidden="true" />
              </span>
              <label htmlFor="edit-project-description" className="text-sm font-semibold text-foreground">
                项目描述
              </label>
              <p className="mt-1 text-xs text-muted-foreground">可选</p>
            </div>
            <Textarea
              id="edit-project-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述项目目标"
              disabled={saving}
              className="min-h-24 text-sm leading-6"
            />
          </section>

          <section className="grid gap-4 border-b border-border py-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
            <div>
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
                <Palette className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold text-foreground">项目颜色</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">跨页面识别色</p>
            </div>
            <ProjectColorPicker value={color} onChange={setColor} disabled={saving} projectName={name} />
          </section>

          <section className="grid gap-4 py-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
            <div>
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
                <Archive className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold text-foreground">归档状态</h3>
            </div>
            <div className="flex items-center justify-between gap-4 border-y border-border py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">归档项目</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">从首页项目列表中隐藏</p>
              </div>
              <Switch
                checked={isArchived}
                onCheckedChange={setIsArchived}
                disabled={saving}
                aria-label="归档项目"
              />
            </div>
          </section>
        </div>

        <DialogFooter className="flex-none gap-2 border-t border-border bg-card px-5 pb-5 pt-4 sm:px-7">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" disabled={saving || !name.trim()} loading={saving}>
            {!saving && <Save className="h-4 w-4" aria-hidden="true" />}
            保存
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
