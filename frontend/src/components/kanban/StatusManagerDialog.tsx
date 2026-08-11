import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Switch } from '../ui/Switch'
import api, { errDetail } from '../../utils/api'
import toast from 'react-hot-toast'
import { cn } from '../../utils/cn'
import type { TaskStatus } from '../../types'
import { Check, Columns3, Loader2, Plus, Trash2 } from 'lucide-react'
import { confirmAction } from '../ui/confirmAction'

interface Props {
  projectId: number
  onClose: () => void
  onUpdated: () => void
}

const PRESET_COLORS = [
  '#6b7280',
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
]

export function StatusManagerDialog({ projectId, onClose, onUpdated }: Props) {
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [editingNames, setEditingNames] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])

  const loadStatuses = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/projects/${projectId}/statuses`)
      const data = res.data as TaskStatus[]
      setStatuses(data)
      const map: Record<number, string> = {}
      data.forEach((s) => (map[s.id] = s.name))
      setEditingNames(map)
    } catch (err: any) {
      toast.error(errDetail(err, '加载状态列失败'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: async loader updates state after await
    loadStatuses()
  }, [loadStatuses])

  const handleUpdate = async (status: TaskStatus, updates: Partial<TaskStatus>) => {
    setSavingId(status.id)
    try {
      await api.put(`/projects/${projectId}/statuses/${status.id}`, updates)
      setStatuses((prev) =>
        prev.map((s) => (s.id === status.id ? { ...s, ...updates } : s))
      )
      onUpdated()
    } catch (err: any) {
      toast.error(errDetail(err, '更新状态列失败'))
      // refresh to be safe
      loadStatuses()
    } finally {
      setSavingId(null)
    }
  }

  const handleDelete = async (status: TaskStatus) => {
    if (status.task_count > 0) {
      toast.error('该状态列中仍有任务，仅空状态列可以删除')
      return
    }
    if (!(await confirmAction({
      title: '删除状态列',
      description: `空状态列「${status.name}」将从当前看板移除。`,
      confirmLabel: '删除状态列',
      tone: 'danger',
      icon: 'delete',
    }))) return
    setDeletingId(status.id)
    try {
      await api.delete(`/projects/${projectId}/statuses/${status.id}`)
      setStatuses((prev) => prev.filter((s) => s.id !== status.id))
      onUpdated()
      toast.success('状态列已删除')
    } catch (err: any) {
      toast.error(errDetail(err, '删除状态列失败'))
    } finally {
      setDeletingId(null)
    }
  }

  const handleAdd = async () => {
    if (!newName.trim()) return
    setAdding(true)
    try {
      await api.post(`/projects/${projectId}/statuses`, {
        name: newName.trim(),
        color: newColor,
        is_done: false,
      })
      setNewName('')
      setNewColor(PRESET_COLORS[0])
      await loadStatuses()
      onUpdated()
      toast.success('状态列已添加')
    } catch (err: any) {
      toast.error(errDetail(err, '添加状态列失败'))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open onClose={onClose} className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-hidden">
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
      <DialogHeader className="relative flex-none overflow-hidden px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
        <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
        <DialogTitle showClose onClose={onClose} className="text-xl leading-tight">
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary text-primary-foreground">
              <Columns3 className="h-4 w-4" aria-hidden="true" />
            </span>
            管理状态列
          </span>
        </DialogTitle>
        <DialogDescription className="pl-[46px]">看板流程与完成规则</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
        {!loading && (
          <div className="grid grid-cols-2 border-y border-border">
            <div className="border-r border-border px-4 py-3">
              <p className="text-[10px] font-semibold text-muted-foreground">状态总数</p>
              <p className="mt-1 text-2xl font-semibold tnum">{statuses.length.toString().padStart(2, '0')}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-muted-foreground">完成状态</p>
              <p className="mt-1 text-2xl font-semibold tnum">{statuses.filter((status) => status.is_done).length.toString().padStart(2, '0')}</p>
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex min-h-48 items-center justify-center border-y border-border text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
            正在读取状态列
          </div>
        ) : statuses.length === 0 ? (
          <div className="border-y border-dashed border-border py-10 text-center text-sm text-muted-foreground">暂无状态列</div>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {statuses.map((status) => (
              <div
                key={status.id}
                className="grid gap-4 px-2 py-4 sm:grid-cols-[minmax(10rem,1fr)_auto] sm:items-center sm:px-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="h-9 w-1.5 flex-none rounded-full"
                    style={{ backgroundColor: status.color }}
                    aria-hidden="true"
                  />
                  <Input
                    value={editingNames[status.id] ?? status.name}
                    onChange={(e) =>
                      setEditingNames((prev) => ({ ...prev, [status.id]: e.target.value }))
                    }
                    onBlur={(e) => {
                      const trimmed = e.target.value.trim()
                      if (trimmed && trimmed !== status.name) {
                        handleUpdate(status, { name: trimmed })
                      } else if (!trimmed) {
                        // Empty name is invalid — restore the stored one instead
                        // of leaving a blank input that disagrees with the server.
                        setEditingNames((prev) => ({ ...prev, [status.id]: status.name }))
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      }
                    }}
                    disabled={savingId === status.id}
                    className="h-9 border-x-0 border-t-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <span className="flex-none text-[10px] text-muted-foreground tnum">{status.task_count} 项</span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleUpdate(status, { color: c })}
                        disabled={savingId === status.id}
                        aria-label={`设置颜色 ${c}`}
                        aria-pressed={status.color === c}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-[7px] border border-black/5 transition-[transform,box-shadow] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          status.color === c && 'scale-105 ring-2 ring-foreground ring-offset-1'
                        )}
                        style={{ backgroundColor: c }}
                      >
                        {status.color === c && <Check className="h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} />}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={status.is_done}
                      onCheckedChange={(checked) => handleUpdate(status, { is_done: checked })}
                      disabled={savingId === status.id}
                      aria-label={`${status.name} 标记为完成列`}
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">完成列</span>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-danger"
                    onClick={() => handleDelete(status)}
                    disabled={deletingId === status.id}
                    aria-label={`删除状态列 ${status.name}`}
                    title="删除状态列"
                  >
                    {deletingId === status.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <section className="overflow-hidden rounded-[8px] border border-border bg-muted/[0.12]">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary/10 text-primary"><Plus className="h-4 w-4" /></span>
            <div><h4 className="text-sm font-semibold">添加状态列</h4><p className="mt-0.5 text-xs text-muted-foreground">扩展当前看板流程</p></div>
          </div>
          <div className="space-y-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="状态列名称"
              disabled={adding}
              className="h-10 flex-1 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  e.preventDefault()
                  handleAdd()
                }
              }}
            />
            <Button onClick={handleAdd} disabled={adding || !newName.trim()} loading={adding}>
              {!adding && <Plus className="h-4 w-4" />}
              添加
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                disabled={adding}
                aria-label={`新列颜色 ${c}`}
                aria-pressed={newColor === c}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-[8px] border border-black/5 transition-[transform,box-shadow] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  newColor === c && 'scale-105 ring-2 ring-foreground ring-offset-1'
                )}
                style={{ backgroundColor: c }}
              >
                {newColor === c && <Check className="h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} />}
              </button>
            ))}
          </div>
          </div>
        </section>
      </div>

      <DialogFooter className="flex-none px-5 sm:px-7">
        <Button variant="ghost" onClick={onClose}>
          关闭
        </Button>
      </DialogFooter>
      </div>
    </Dialog>
  )
}
