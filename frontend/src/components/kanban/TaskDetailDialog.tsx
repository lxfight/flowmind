import { useCallback, useEffect, useState } from 'react'
import { X, Calendar, User, AlertCircle, MessageSquare, ChevronDown, Check, ListTodo, Plus, Loader2 } from 'lucide-react'
import api from '../../utils/api'
import toast from 'react-hot-toast'
import { AnimatedDialog } from '../common/AnimatedDialog'
import type { MemberOption, TaskDetail } from '../../types'

interface Props {
  taskId: number
  projectId: number
  onClose: () => void
  onUpdated: () => void
}

export function TaskDetailDialog({ taskId, projectId, onClose, onUpdated }: Props) {
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<MemberOption[]>([])
  const [membersError, setMembersError] = useState(false)
  const [showAssigneePicker, setShowAssigneePicker] = useState(false)
  const [updatingAssignee, setUpdatingAssignee] = useState(false)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [addingComment, setAddingComment] = useState(false)
  const [completing, setCompleting] = useState(false)

  const refreshTask = useCallback(async () => {
    const res = await api.get(`/projects/${projectId}/tasks/${taskId}`)
    setTask(res.data)
    return res.data as TaskDetail
  }, [projectId, taskId])

  const loadTaskDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await refreshTask()
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
      setShowAssigneePicker(false)
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

  if (loading) {
    return (
      <AnimatedDialog open onClose={onClose} className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-lg">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </AnimatedDialog>
    )
  }

  if (error || !task) {
    return (
      <AnimatedDialog open onClose={onClose} className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-lg">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold dark:text-gray-100">任务详情</h3>
            <p className="text-sm text-red-500 mt-2">{error || '任务不存在或无权访问'}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={18} /></button>
        </div>
        <button className="btn-secondary text-sm" onClick={loadTaskDetail}>
          重试
        </button>
      </AnimatedDialog>
    )
  }

  const priorityLabels = ['', '低', '中', '高', '紧急']
  const priorityColors = ['', 'text-blue-500', 'text-yellow-500', 'text-orange-500', 'text-red-500']

  return (
    <AnimatedDialog open onClose={onClose} className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-4 border-b dark:border-gray-700">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <input type="checkbox" checked={task.is_completed} onChange={handleComplete} disabled={completing}
                className="w-4 h-4 text-primary-500 rounded" />
              <h3 className={`text-lg font-semibold dark:text-gray-100 ${task.is_completed ? 'line-through text-gray-400 dark:text-gray-500' : ''}`}>
                {task.title}
              </h3>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {task.priority > 0 && (
                <span className={`flex items-center gap-1 ${priorityColors[task.priority]}`}>
                  <AlertCircle size={12} /> {priorityLabels[task.priority]}
                </span>
              )}
              {/* Assignee picker */}
              <div className="relative">
                <button
                  className={`flex items-center gap-1 hover:text-primary-600 transition-colors ${updatingAssignee ? 'opacity-50' : ''}`}
                  onClick={() => setShowAssigneePicker(!showAssigneePicker)}
                  disabled={updatingAssignee}
                >
                  <User size={12} />
                  <span>{task.assignee?.display_name || '未指派'}</span>
                  <ChevronDown size={10} className={`transition-transform ${showAssigneePicker ? 'rotate-180' : ''}`} />
                </button>
                {showAssigneePicker && (
                  <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-lg border z-10 py-1">
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-1.5"
                      onClick={() => handleAssigneeChange(null)}
                    >
                      {!task.assignee && <Check size={12} />}
                      <span className={!task.assignee ? 'font-medium' : ''}>未指派</span>
                    </button>
                    {members.map((m) => (
                      <button
                        key={m.user_id}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-1.5"
                        onClick={() => handleAssigneeChange(m.user_id)}
                      >
                        {task.assignee?.id === m.user_id && <Check size={12} />}
                        <span className={task.assignee?.id === m.user_id ? 'font-medium' : ''}>
                          {m.display_name || m.username}
                        </span>
                      </button>
                    ))}
                    {membersError && (
                      <div className="px-3 py-1.5 text-xs text-red-500">成员列表加载失败</div>
                    )}
                  </div>
                )}
              </div>
              {task.due_date && (
                <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(task.due_date).toLocaleDateString('zh-CN')}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Description */}
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">描述</h4>
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{task.description || '无描述'}</p>
          </div>

          {/* Subtasks */}
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-1.5">
              <ListTodo size={14} />
              子任务 ({task.subtasks?.length || 0})
              {task.subtasks && task.subtasks.length > 0 && (
                <span className="text-xs text-gray-400">
                  — {task.subtasks.filter(s => s.is_completed).length}/{task.subtasks.length} 完成
                </span>
              )}
            </h4>
            <div className="space-y-1.5 mb-3">
              {(task.subtasks || []).length === 0 ? (
                <p className="text-sm text-gray-400 py-2">暂无子任务</p>
              ) : (
                task.subtasks!.map((sub) => (
                  <label
                    key={sub.id}
                    className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                      sub.is_completed ? 'bg-gray-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={sub.is_completed}
                      onChange={() => handleSubtaskComplete(sub.id, sub.is_completed)}
                      className="w-3.5 h-3.5 text-primary-500 rounded flex-shrink-0"
                    />
                    <span className={`text-sm ${sub.is_completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                      {sub.title}
                    </span>
                  </label>
                ))
              )}
            </div>
            {/* Add subtask */}
            <div className="flex gap-2">
              <input
                className="input-field flex-1 text-sm"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleAddSubtask()
                  }
                }}
                placeholder="添加子任务..."
              />
              <button
                className="btn-primary text-sm flex items-center gap-1"
                onClick={handleAddSubtask}
                disabled={addingSubtask || !newSubtaskTitle.trim()}
              >
                {addingSubtask ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                添加
              </button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <h4 className="text-sm font-medium text-gray-500 mb-3 flex items-center gap-1.5">
              <MessageSquare size={14} /> 评论 ({task.comments?.length || 0})
            </h4>
            <div className="space-y-3 mb-4">
              {(task.comments || []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">暂无评论</p>
              ) : (
                (task.comments || []).map(c => (
                  <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">{c.user?.display_name}</span>
                      <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleString('zh-CN')}</span>
                    </div>
                    <p className="text-sm text-gray-700">{c.content}</p>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input className="input-field flex-1 text-sm" value={newComment} onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAddComment()}
                disabled={addingComment}
                placeholder="输入评论..." />
              <button className="btn-primary text-sm" onClick={handleAddComment} disabled={addingComment || !newComment.trim()}>
                {addingComment ? '发送中...' : '发送'}
              </button>
            </div>
          </div>
        </div>
    </AnimatedDialog>
  )
}
