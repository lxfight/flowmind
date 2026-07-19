import { useCallback, useEffect, useState } from 'react'
import {
  Calendar,
  User,
  AlertCircle,
  MessageSquare,
  ListTodo,
  Plus,
  Loader2,
  Edit2,
  Save,
  X,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react'
import api from '../../utils/api'
import toast from 'react-hot-toast'
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
import { Select } from '../ui/Select'
import { Badge } from '../ui/Badge'
import { Avatar } from '../ui/Avatar'
import { Separator } from '../ui/Separator'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu'
import type { MemberOption, StatusOption, TaskDetail } from '../../types'

interface Props {
  taskId: number
  projectId: number
  statuses: StatusOption[]
  onClose: () => void
  onUpdated: () => void
}

const priorityOptions = [
  { value: 0, label: '无优先级', variant: 'secondary' as const },
  { value: 1, label: '低', variant: 'info' as const },
  { value: 2, label: '中', variant: 'warning' as const },
  { value: 3, label: '高', variant: 'danger' as const },
  { value: 4, label: '紧急', variant: 'danger' as const },
]

export function TaskDetailDialog({ taskId, projectId, statuses, onClose, onUpdated }: Props) {
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<MemberOption[]>([])
  const [membersError, setMembersError] = useState(false)
  const [updatingAssignee, setUpdatingAssignee] = useState(false)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [addingComment, setAddingComment] = useState(false)
  const [completing, setCompleting] = useState(false)

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPriority, setEditPriority] = useState(0)
  const [editStatusId, setEditStatusId] = useState<number>(0)
  const [editDueDate, setEditDueDate] = useState('')

  const resetEditFields = useCallback((t: TaskDetail) => {
    setEditTitle(t.title)
    setEditDescription(t.description || '')
    setEditPriority(t.priority)
    setEditStatusId(t.status_id)
    setEditDueDate(t.due_date ? t.due_date.slice(0, 10) : '')
  }, [])

  const refreshTask = useCallback(async () => {
    const res = await api.get(`/projects/${projectId}/tasks/${taskId}`)
    const data = res.data as TaskDetail
    setTask(data)
    if (isEditing) resetEditFields(data)
    return data
  }, [projectId, taskId, isEditing, resetEditFields])

  const loadTaskDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await refreshTask()
      resetEditFields(data)
    } catch {
      setError('任务详情加载失败')
      toast.error('加载任务详情失败')
    } finally {
      setLoading(false)
    }
  }, [refreshTask])

  const loadMembers = useCallback(async () => {
    setMembersError(false)
    try {
      const res = await api.get(`/projects/${projectId}/members`)
      setMembers(res.data)
    } catch {
      setMembers([])
      setMembersError(true)
      toast.error('成员列表加载失败，任务详情仍可查看')
    }
  }, [projectId])

  useEffect(() => {
    loadTaskDetail()
    loadMembers()
  }, [loadTaskDetail, loadMembers])

  const handleAddComment = async () => {
    if (!newComment.trim() || !task || addingComment) return
    setAddingComment(true)
    try {
      await api.post(`/projects/${projectId}/tasks/${taskId}/comments`, { content: newComment.trim() })
      setNewComment('')
      await refreshTask()
    } catch {
      toast.error('发送评论失败')
    } finally {
      setAddingComment(false)
    }
  }

  const handleComplete = async () => {
    if (!task) return
    setCompleting(true)
    try {
      await api.put(`/projects/${projectId}/tasks/${taskId}`, { is_completed: !task.is_completed })
      onUpdated()
      onClose()
    } catch {
      toast.error('更新任务状态失败')
    } finally {
      setCompleting(false)
    }
  }

  const handleAssigneeChange = async (userId: number | null) => {
    if (!task) return
    setUpdatingAssignee(true)
    try {
      await api.put(`/projects/${projectId}/tasks/${taskId}`, { assignee_id: userId })
      await refreshTask()
      onUpdated()
    } catch {
      toast.error('更新指派人失败')
    } finally {
      setUpdatingAssignee(false)
    }
  }

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim() || !task) return
    setAddingSubtask(true)
    try {
      await api.post(`/projects/${projectId}/tasks`, {
        title: newSubtaskTitle.trim(),
        status_id: task.status_id,
        parent_task_id: task.id,
        priority: 0,
      })
      setNewSubtaskTitle('')
      await refreshTask()
      onUpdated()
    } catch {
      toast.error('创建子任务失败')
    } finally {
      setAddingSubtask(false)
    }
  }

  const handleSubtaskComplete = async (subtaskId: number, completed: boolean) => {
    try {
      await api.put(`/projects/${projectId}/tasks/${subtaskId}`, { is_completed: !completed })
      await refreshTask()
      onUpdated()
    } catch {
      toast.error('更新子任务失败')
    }
  }

  const handleSaveEdit = async () => {
    if (!task || !editTitle.trim()) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        title: editTitle.trim(),
        description: editDescription,
        priority: editPriority,
        status_id: editStatusId,
      }
      if (editDueDate) {
        payload.due_date = new Date(editDueDate).toISOString()
      } else {
        payload.due_date = null
      }
      await api.put(`/projects/${projectId}/tasks/${taskId}`, payload)
      setIsEditing(false)
      await refreshTask()
      onUpdated()
      toast.success('任务已更新')
    } catch {
      toast.error('更新任务失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    if (task) resetEditFields(task)
    setIsEditing(false)
  }

  if (loading) {
    return (
      <Dialog open onClose={onClose}>
        <div className="p-6 space-y-4">
          <div className="h-6 w-3/4 rounded bg-muted animate-pulse" />
          <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
          <div className="h-20 rounded bg-muted animate-pulse" />
        </div>
      </Dialog>
    )
  }

  if (error || !task) {
    return (
      <Dialog open onClose={onClose}>
        <DialogHeader>
          <DialogTitle showClose onClose={onClose}>任务详情</DialogTitle>
          <DialogDescription>{error || '任务不存在或无权访问'}</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-4 mb-4 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-danger" />
            无法加载任务详情，请检查网络或权限
          </div>
          <Button variant="outline" onClick={loadTaskDetail} className="gap-1.5">
            <RotateCcw className="h-4 w-4" />
            重试
          </Button>
        </div>
      </Dialog>
    )
  }

  const priority = priorityOptions[task.priority]
  const isOverdue = task.due_date && !task.is_completed && new Date(task.due_date) < new Date()

  const assigneeTrigger = (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 h-7 px-2"
      disabled={updatingAssignee || isEditing}
    >
      <User className="h-3.5 w-3.5" />
      <span className="max-w-[120px] truncate">{task.assignee?.display_name || '未指派'}</span>
    </Button>
  )

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <DialogHeader className="pb-2">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={task.is_completed}
            onChange={handleComplete}
            disabled={completing || isEditing}
            className="mt-1.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                disabled={saving}
                placeholder="任务标题"
                className="text-base font-semibold"
              />
            ) : (
              <DialogTitle
                className={task.is_completed ? 'line-through text-muted-foreground' : ''}
              >
                {task.title}
              </DialogTitle>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isEditing ? (
                <>
                  <Select
                    value={editPriority}
                    onChange={(e) => setEditPriority(parseInt(e.target.value))}
                    disabled={saving}
                    className="w-28 h-8 text-xs"
                  >
                    {priorityOptions.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                  <Select
                    value={editStatusId}
                    onChange={(e) => setEditStatusId(parseInt(e.target.value))}
                    disabled={saving}
                    className="w-32 h-8 text-xs"
                  >
                    {statuses.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                  <Input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    disabled={saving}
                    className="w-36 h-8 text-xs"
                  />
                </>
              ) : (
                <>
                  {task.priority > 0 && (
                    <Badge variant={priority.variant}>
                      <AlertCircle className="mr-1 h-3 w-3" />
                      {priority.label}
                    </Badge>
                  )}
                  <DropdownMenu trigger={assigneeTrigger}>
                    <DropdownMenuItem onClick={() => handleAssigneeChange(null)}>
                      <X className="mr-2 h-4 w-4" />
                      未指派
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {members.map((m) => (
                      <DropdownMenuItem
                        key={m.user_id}
                        onClick={() => handleAssigneeChange(m.user_id)}
                      >
                        <Avatar name={m.display_name || m.username} size="sm" className="mr-2" />
                        {m.display_name || m.username}
                        {task.assignee?.id === m.user_id && <span className="ml-auto text-primary">✓</span>}
                      </DropdownMenuItem>
                    ))}
                    {membersError && (
                      <div className="px-2 py-1.5 text-xs text-danger">成员列表加载失败</div>
                    )}
                  </DropdownMenu>

                  {task.due_date && (
                    <Badge variant={isOverdue ? 'danger' : 'secondary'} className="gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(task.due_date).toLocaleDateString('zh-CN')}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </DialogHeader>

      <div className="px-6 pb-6 max-h-[60vh] overflow-y-auto space-y-6">
        {/* Description */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">描述</h4>
          {isEditing ? (
            <Textarea
              rows={5}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              disabled={saving}
              placeholder="任务描述..."
            />
          ) : (
            <p className="text-sm text-foreground whitespace-pre-wrap rounded-md bg-muted/30 p-3">
              {task.description || '无描述'}
            </p>
          )}
        </div>

        <Separator />

        {/* Subtasks */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <ListTodo className="h-4 w-4" />
            子任务 ({task.subtasks?.length || 0})
            {task.subtasks && task.subtasks.length > 0 && (
              <span className="text-xs text-muted-foreground ml-1">
                — {task.subtasks.filter((s) => s.is_completed).length}/{task.subtasks.length} 完成
              </span>
            )}
          </h4>
          <div className="space-y-1.5">
            {(task.subtasks || []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">暂无子任务</p>
            ) : (
              task.subtasks!.map((sub) => (
                <label
                  key={sub.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-2.5 cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={sub.is_completed}
                    onChange={() => handleSubtaskComplete(sub.id, sub.is_completed)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className={`text-sm ${sub.is_completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {sub.title}
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleAddSubtask()
                }
              }}
              placeholder="添加子任务..."
              className="text-sm"
            />
            <Button
              onClick={handleAddSubtask}
              disabled={addingSubtask || !newSubtaskTitle.trim()}
              loading={addingSubtask}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Separator />

        {/* Comments */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <MessageSquare className="h-4 w-4" />
            评论 ({task.comments?.length || 0})
          </h4>
          <div className="space-y-3">
            {(task.comments || []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">暂无评论</p>
            ) : (
              task.comments!.map((c) => (
                <div key={c.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium">{c.user?.display_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{c.content}</p>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddComment()}
              disabled={addingComment}
              placeholder="输入评论..."
              className="text-sm"
            />
            <Button
              onClick={handleAddComment}
              disabled={addingComment || !newComment.trim()}
              loading={addingComment}
            >
              发送
            </Button>
          </div>
        </div>
      </div>

      <DialogFooter>
        {isEditing ? (
          <>
            <Button variant="outline" onClick={handleCancelEdit} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving || !editTitle.trim()} loading={saving}>
              <Save className="mr-1.5 h-4 w-4" />
              保存
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setIsEditing(true)} className="gap-1.5">
            <Edit2 className="h-4 w-4" />
            编辑任务
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
