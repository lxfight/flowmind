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
    if (!confirm(`确定删除状态列「${status.name}」？仅空状态列可删除。`)) return
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
    <Dialog open onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle showClose onClose={onClose}>管理状态列</DialogTitle>
        <DialogDescription>编辑、添加或删除看板状态列。</DialogDescription>
      </DialogHeader>

      <div className="px-6 pb-6 max-h-[60vh] overflow-y-auto space-y-4">
        {loading ? (
          <div className="space-y-2">
            <div className="h-10 rounded bg-muted animate-pulse" />
            <div className="h-10 rounded bg-muted animate-pulse" />
          </div>
        ) : statuses.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无状态列</p>
        ) : (
          <div className="space-y-2">
            {statuses.map((status) => (
              <div
                key={status.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-border bg-muted/30 p-3"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span
                    className="h-3 w-3 rounded-full flex-shrink-0"
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
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      }
                    }}
                    disabled={savingId === status.id}
                    className="h-8 text-sm"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                  <div className="flex flex-wrap items-center gap-1">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleUpdate(status, { color: c })}
                        disabled={savingId === status.id}
                        aria-label={`设置颜色 ${c}`}
                        aria-pressed={status.color === c}
                        className={cn(
                          'h-5 w-5 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          status.color === c && 'ring-2 ring-offset-1 ring-foreground scale-110'
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 ml-2">
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
                  >
                    {deletingId === status.id ? (
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                    ) : (
                      <span className="text-sm">×</span>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-border p-3 space-y-3">
          <h4 className="text-sm font-medium">添加状态列</h4>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="状态列名称"
              disabled={adding}
              className="flex-1 h-9 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  e.preventDefault()
                  handleAdd()
                }
              }}
            />
            <Button onClick={handleAdd} disabled={adding || !newName.trim()} loading={adding} size="sm">
              添加
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                disabled={adding}
                aria-label={`新列颜色 ${c}`}
                aria-pressed={newColor === c}
                className={cn(
                  'h-5 w-5 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  newColor === c && 'ring-2 ring-offset-1 ring-foreground scale-110'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
