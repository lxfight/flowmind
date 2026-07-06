import { useState, useEffect } from 'react'
import { X, Calendar, User, AlertCircle, MessageSquare } from 'lucide-react'
import api from '../../utils/api'

interface TaskDetail {
  id: number
  title: string
  description: string
  status_id: number
  priority: number
  assignee: { id: number; display_name: string } | null
  due_date: string | null
  is_completed: boolean
  created_at: string
  updated_at: string
  comments: Array<{
    id: number
    content: string
    created_at: string
    user: { id: number; display_name: string }
  }>
}

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

  useEffect(() => {
    api.get(`/projects/${projectId}/tasks/${taskId}`).then(res => {
      setTask(res.data)
      setLoading(false)
    })
  }, [taskId, projectId])

  const handleAddComment = async () => {
    if (!newComment.trim() || !task) return
    await api.post(`/projects/${projectId}/tasks/${taskId}/comments`, { content: newComment })
    setNewComment('')
    const res = await api.get(`/projects/${projectId}/tasks/${taskId}`)
    setTask(res.data)
  }

  const handleComplete = async () => {
    if (!task) return
    await api.put(`/projects/${projectId}/tasks/${taskId}`, { is_completed: !task.is_completed })
    onUpdated()
    onClose()
  }

  if (loading || !task) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-3/4" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
            <div className="h-20 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    )
  }

  const priorityLabels = ['', '低', '中', '高', '紧急']
  const priorityColors = ['', 'text-blue-500', 'text-yellow-500', 'text-orange-500', 'text-red-500']

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <input type="checkbox" checked={task.is_completed} onChange={handleComplete}
                className="w-4 h-4 text-primary-500 rounded" />
              <h3 className={`text-lg font-semibold ${task.is_completed ? 'line-through text-gray-400' : ''}`}>
                {task.title}
              </h3>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {task.priority > 0 && (
                <span className={`flex items-center gap-1 ${priorityColors[task.priority]}`}>
                  <AlertCircle size={12} /> {priorityLabels[task.priority]}
                </span>
              )}
              {task.assignee && (
                <span className="flex items-center gap-1"><User size={12} /> {task.assignee.display_name}</span>
              )}
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
            <h4 className="text-sm font-medium text-gray-500 mb-2">描述</h4>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{task.description || '无描述'}</p>
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
                placeholder="输入评论..." />
              <button className="btn-primary text-sm" onClick={handleAddComment}>发送</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
