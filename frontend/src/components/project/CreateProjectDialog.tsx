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
import { AlignLeft, FolderPlus, Palette, Plus, Type } from 'lucide-react'

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
    <Dialog
      open
      onClose={submitting ? () => {} : onClose}
      className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-hidden"
    >
      <form onSubmit={handleSubmit} className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader className="relative flex-none overflow-hidden border-b border-border px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
          <span
            className="absolute inset-y-0 left-0 w-1 bg-primary"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <DialogTitle showClose onClose={submitting ? undefined : onClose} className="text-xl leading-tight">
            <span className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-[8px] text-white transition-colors"
                style={{ backgroundColor: color }}
              >
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
              </span>
              新建项目
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
              <label htmlFor="create-project-name" className="text-sm font-semibold text-foreground">
                项目名称
              </label>
              <p className="mt-1 text-xs text-muted-foreground">必填</p>
            </div>
            <Input
              id="create-project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称"
              required
              autoFocus
              disabled={submitting}
              className="h-11 text-base"
            />
          </section>

          <section className="grid gap-4 border-b border-border py-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
            <div>
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
                <AlignLeft className="h-4 w-4" aria-hidden="true" />
              </span>
              <label htmlFor="create-project-description" className="text-sm font-semibold text-foreground">
                项目描述
              </label>
              <p className="mt-1 text-xs text-muted-foreground">可选</p>
            </div>
            <Textarea
              id="create-project-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述项目目标"
              disabled={submitting}
              className="min-h-24 text-sm leading-6"
            />
          </section>

          <section className="grid gap-4 py-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8">
            <div>
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
                <Palette className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold text-foreground">项目颜色</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">跨页面识别色</p>
            </div>
            <ProjectColorPicker value={color} onChange={setColor} disabled={submitting} projectName={name} />
          </section>
        </div>

        <DialogFooter className="flex-none gap-2 border-t border-border bg-card px-5 pb-5 pt-4 sm:px-7">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" disabled={submitting || !name.trim()} loading={submitting}>
            {!submitting && <Plus className="h-4 w-4" aria-hidden="true" />}
            创建项目
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
