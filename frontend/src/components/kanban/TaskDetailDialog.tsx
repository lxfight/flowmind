import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Calendar,
  AlertCircle,
  MessageSquare,
  ListTodo,
  Plus,
  Loader2,
  Edit2,
  Save,
  AlertTriangle,
  RotateCcw,
  Trash2,
  Sparkles,
  Paperclip,
  Download,
  Flag,
  Link2,
  Copy,
  X,
  Reply,
} from 'lucide-react'
import api, { errDetail } from '../../utils/api'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../stores/authStore'
import { useProjectRole } from '../../hooks/useProjectRole'
import { useProjectSocket } from '../../hooks/useProjectSocket'
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
import { Separator } from '../ui/Separator'
import { MarkdownContent } from '../ui/MarkdownContent'
import { confirmAction } from '../ui/confirmAction'
import { AssigneePicker } from './AssigneePicker'
import { MentionText } from './MentionText'
import { MilestonePicker } from '../milestones/MilestonePicker'
import { listMilestones } from '../../api/milestones'
import { getTaskReferences } from '../../api/tasks'
import { cn } from '../../utils/cn'
import { useTaskReferenceAutocomplete } from '../../hooks/useTaskReferenceAutocomplete'
import { TaskReferenceMenu } from './TaskReferenceMenu'
import type { MemberOption, Milestone, StatusOption, TaskAttachment, TaskComment, TaskDetail, TaskReferences } from '../../types'

interface CommentNode {
  comment: TaskComment
  replies: CommentNode[]
}

interface Props {
  taskId: number
  projectId: number
  focusCommentId?: number | null
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

/** Consistent section header style across description/subtasks/attachments/comments */
const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground'

export function TaskDetailDialog({
  taskId,
  projectId,
  focusCommentId,
  statuses,
  onClose,
  onUpdated,
}: Props) {
  const currentUser = useAuthStore((s) => s.user)
  const userRole = useProjectRole()
  const isViewer = userRole === 'viewer'
  const canDelete = userRole === 'owner' || userRole === 'admin'
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Bumped per task load so a stale detail response can't overwrite a newer one. */
  const taskLoadSeq = useRef(0)
  const [members, setMembers] = useState<MemberOption[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [updatingAssignee, setUpdatingAssignee] = useState(false)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [addingComment, setAddingComment] = useState(false)
  const [replyingToCommentId, setReplyingToCommentId] = useState<number | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingCommentContent, setEditingCommentContent] = useState('')
  const [savingComment, setSavingComment] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null)
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null)
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('')
  const [savingSubtaskId, setSavingSubtaskId] = useState<number | null>(null)
  const [deletingSubtaskId, setDeletingSubtaskId] = useState<number | null>(null)
  const [suggestingStatus, setSuggestingStatus] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [references, setReferences] = useState<TaskReferences>({ outgoing: [], incoming: [] })

  useEffect(() => {
    if (!task || !focusCommentId) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(`task-comment-${focusCommentId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [task, focusCommentId])

  // Attachments
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const wsRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // @mention autocomplete in the comment input
  const commentInputRef = useRef<HTMLInputElement | null>(null)
  const descriptionInputRef = useRef<HTMLTextAreaElement | null>(null)
  const editingCommentInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)

  /** Track the active `@query` fragment right before the caret, if any. */
  const updateMentionQuery = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) {
      setMentionQuery(null)
      return
    }
    const q = before.slice(at + 1)
    setMentionQuery(/^[A-Za-z0-9_.-]*$/.test(q) ? q : null)
  }, [])

  const insertMention = useCallback((username: string) => {
    setNewComment((prev) => {
      const caret = commentInputRef.current?.selectionStart ?? prev.length
      const before = prev.slice(0, caret)
      const at = before.lastIndexOf('@')
      return before.slice(0, at) + '@' + username + ' ' + prev.slice(caret)
    })
    setMentionQuery(null)
    commentInputRef.current?.focus()
  }, [])

  const mentionCandidates =
    mentionQuery !== null
      ? members
          .filter((m) =>
            mentionQuery === ''
              ? true
              : m.username.toLowerCase().includes(mentionQuery.toLowerCase()) ||
                m.display_name.toLowerCase().includes(mentionQuery.toLowerCase())
          )
          .slice(0, 6)
      : []

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPriority, setEditPriority] = useState(0)
  const [editStatusId, setEditStatusId] = useState<number>(0)
  const [editDueDate, setEditDueDate] = useState('')
  const [editMilestoneIds, setEditMilestoneIds] = useState<number[]>([])
  const commentTaskReference = useTaskReferenceAutocomplete({
    projectId,
    excludeTaskId: taskId,
    value: newComment,
    onChange: setNewComment,
    inputRef: commentInputRef,
  })
  const commentThreads = useMemo(() => {
    const comments = task?.comments || []
    const byId = new Map(comments.map((comment) => [comment.id, comment]))
    const childrenById = new Map<number, TaskComment[]>()

    comments.forEach((comment) => {
      if (comment.parent_comment_id == null) return
      const siblings = childrenById.get(comment.parent_comment_id) || []
      siblings.push(comment)
      childrenById.set(comment.parent_comment_id, siblings)
    })

    const buildThread = (comment: TaskComment): CommentNode => ({
      comment,
      replies: (childrenById.get(comment.id) || []).map(buildThread),
    })

    return {
      byId,
      threads: comments
        .filter((comment) => comment.parent_comment_id == null || !byId.has(comment.parent_comment_id))
        .map(buildThread),
    }
  }, [task?.comments])
  const replyingToComment = replyingToCommentId == null
    ? null
    : commentThreads.byId.get(replyingToCommentId) || null
  const descriptionTaskReference = useTaskReferenceAutocomplete({
    projectId,
    excludeTaskId: taskId,
    value: editDescription,
    onChange: setEditDescription,
    inputRef: descriptionInputRef,
  })
  const editingCommentTaskReference = useTaskReferenceAutocomplete({
    projectId,
    excludeTaskId: taskId,
    value: editingCommentContent,
    onChange: setEditingCommentContent,
    inputRef: editingCommentInputRef,
  })

  const resetEditFields = useCallback((t: TaskDetail) => {
    setEditTitle(t.title)
    setEditDescription(t.description || '')
    setEditPriority(t.priority)
    setEditStatusId(t.status_id)
    setEditDueDate(t.due_date ? t.due_date.slice(0, 10) : '')
    setEditMilestoneIds(t.milestone_ids)
  }, [])

  const refreshTask = useCallback(async () => {
    const requestId = ++taskLoadSeq.current
    const res = await api.get(`/projects/${projectId}/tasks/${taskId}`)
    const data = res.data as TaskDetail
    if (requestId === taskLoadSeq.current) setTask(data)
    return data
  }, [projectId, taskId])

  const refreshReferences = useCallback(async () => {
    const requestId = taskLoadSeq.current
    try {
      const data = await getTaskReferences(projectId, taskId)
      if (requestId === taskLoadSeq.current) setReferences(data)
      return data
    } catch {
      const empty = { outgoing: [], incoming: [] }
      if (requestId === taskLoadSeq.current) setReferences(empty)
      return empty
    }
  }, [projectId, taskId])

  const loadTaskDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [data] = await Promise.all([refreshTask(), refreshReferences()])
      resetEditFields(data)
    } catch {
      setError('任务详情加载失败')
      toast.error('加载任务详情失败')
    } finally {
      setLoading(false)
    }
  }, [refreshReferences, refreshTask, resetEditFields])

  const loadAttachments = useCallback(async () => {
    const requestId = taskLoadSeq.current
    try {
      const res = await api.get(`/projects/${projectId}/tasks/${taskId}/attachments`)
      if (requestId === taskLoadSeq.current) setAttachments(res.data)
    } catch {
      if (requestId === taskLoadSeq.current) setAttachments([])
    }
  }, [projectId, taskId])

  const handleUploadAttachment = async (file: File) => {
    if (uploadingAttachment) return
    if (file.size > 20 * 1024 * 1024) {
      toast.error('附件大小不能超过 20MB')
      return
    }
    setUploadingAttachment(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.post(`/projects/${projectId}/tasks/${taskId}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      await loadAttachments()
      toast.success('附件已上传')
    } catch (err: any) {
      toast.error(errDetail(err, '附件上传失败'))
    } finally {
      setUploadingAttachment(false)
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    }
  }

  const handleDownloadAttachment = async (attachment: TaskAttachment) => {
    try {
      const res = await api.get(
        `/projects/${projectId}/tasks/${taskId}/attachments/${attachment.id}/download`,
        { responseType: 'blob' },
      )
      const url = URL.createObjectURL(res.data as Blob)
      const link = document.createElement('a')
      link.href = url
      link.download = attachment.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Revoke later so Firefox isn't interrupted mid-download.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      toast.error('附件下载失败')
    }
  }

  const handleDeleteAttachment = async (attachment: TaskAttachment) => {
    if (!(await confirmAction({
      title: '删除任务附件',
      description: `附件「${attachment.filename}」将被永久删除。`,
      confirmLabel: '删除附件',
      tone: 'danger',
      icon: 'delete',
    }))) return
    setDeletingAttachmentId(attachment.id)
    try {
      await api.delete(`/projects/${projectId}/tasks/${taskId}/attachments/${attachment.id}`)
      await loadAttachments()
      toast.success('附件已删除')
    } catch (err: any) {
      toast.error(errDetail(err, '删除附件失败'))
    } finally {
      setDeletingAttachmentId(null)
    }
  }

  const loadMembers = useCallback(async () => {
    try {
      const res = await api.get(`/projects/${projectId}/members`)
      setMembers(res.data)
    } catch {
      setMembers([])
      toast.error('成员列表加载失败，任务详情仍可查看')
    }
  }, [projectId])

  const loadMilestones = useCallback(async () => {
    try {
      setMilestones(await listMilestones(projectId))
    } catch {
      setMilestones([])
    }
  }, [projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: async loaders update state after await
    loadTaskDetail()
    loadMembers()
    loadMilestones()
    loadAttachments()
    return () => {
      if (wsRefreshRef.current) clearTimeout(wsRefreshRef.current)
    }
  }, [loadTaskDetail, loadMembers, loadMilestones, loadAttachments])

  // Real-time sync: refresh this dialog when other clients touch the task.
  useProjectSocket(projectId, (event) => {
    if (event.actor_id && event.actor_id === currentUser?.id) return
    const payload = (event.payload || {}) as { task_id?: number }
    const isTaskEvent = ['task_updated', 'task_moved', 'task_deleted'].includes(event.type)
    if (event.type.startsWith('milestone_')) {
      void loadMilestones()
      void refreshTask().catch(() => {})
      return
    }
    const isChildEvent = [
      'comment_created',
      'comment_updated',
      'comment_deleted',
      'attachment_added',
      'attachment_deleted',
      'subtask_updated',
      'subtask_deleted',
    ].includes(event.type)
    if ((isTaskEvent && payload.task_id === taskId) || (isChildEvent && payload.task_id === taskId)) {
      if (wsRefreshRef.current) clearTimeout(wsRefreshRef.current)
      wsRefreshRef.current = setTimeout(() => {
        void refreshTask().catch(() => {})
        void refreshReferences().catch(() => {})
        void loadAttachments().catch(() => {})
      }, 300)
    }
  })

  const handleAddComment = async () => {
    if (!newComment.trim() || !task || addingComment) return
    setAddingComment(true)
    try {
      await api.post(`/projects/${projectId}/tasks/${taskId}/comments`, {
        content: newComment.trim(),
        parent_comment_id: replyingToCommentId,
      })
      setNewComment('')
      setReplyingToCommentId(null)
      setMentionQuery(null)
      commentTaskReference.close()
      await Promise.all([refreshTask(), refreshReferences()])
    } catch {
      toast.error('发送评论失败')
    } finally {
      setAddingComment(false)
    }
  }

  const handleEditComment = async (commentId: number) => {
    if (!editingCommentContent.trim() || savingComment) return
    setSavingComment(true)
    try {
      await api.patch(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}`, {
        content: editingCommentContent.trim(),
      })
      setEditingCommentId(null)
      setEditingCommentContent('')
      await Promise.all([refreshTask(), refreshReferences()])
      toast.success('评论已更新')
    } catch (err: any) {
      toast.error(errDetail(err, '更新评论失败'))
    } finally {
      setSavingComment(false)
    }
  }

  const handleDeleteComment = async (commentId: number) => {
    if (!(await confirmAction({
      title: '删除评论',
      description: '这条评论将从任务动态中永久移除。',
      confirmLabel: '删除评论',
      tone: 'danger',
      icon: 'delete',
    }))) return
    setDeletingCommentId(commentId)
    try {
      await api.delete(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}`)
      if (replyingToCommentId === commentId) setReplyingToCommentId(null)
      await Promise.all([refreshTask(), refreshReferences()])
      toast.success('评论已删除')
    } catch (err: any) {
      toast.error(errDetail(err, '删除评论失败'))
    } finally {
      setDeletingCommentId(null)
    }
  }

  const handleSuggestStatus = async () => {
    if (!editTitle.trim() || suggestingStatus) return
    setSuggestingStatus(true)
    try {
      const res = await api.post('/llm/suggest-status', null, {
        params: {
          project_id: projectId,
          task_title: editTitle.trim(),
          task_description: editDescription,
        },
      })
      const { suggested_status, suggested_name } = res.data
      if (suggested_status) {
        setEditStatusId(suggested_status)
        toast.success(`AI 建议移动到「${suggested_name}」，已为你选中`)
      } else {
        toast.error('AI 未能给出状态建议')
      }
    } catch {
      toast.error('获取 AI 状态建议失败')
    } finally {
      setSuggestingStatus(false)
    }
  }

  const handleAssigneeChange = async (userIds: number[]) => {
    if (!task) return
    setUpdatingAssignee(true)
    try {
      await api.put(`/projects/${projectId}/tasks/${taskId}`, { assignee_ids: userIds })
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
    setSavingSubtaskId(subtaskId)
    try {
      await api.patch(`/projects/${projectId}/tasks/${taskId}/subtasks/${subtaskId}`, {
        is_completed: !completed,
      })
      await refreshTask()
      onUpdated()
    } catch {
      toast.error('更新子任务失败')
    } finally {
      setSavingSubtaskId(null)
    }
  }

  const startEditingSubtask = (subtaskId: number, title: string) => {
    setEditingSubtaskId(subtaskId)
    setEditingSubtaskTitle(title)
  }

  const cancelEditingSubtask = () => {
    setEditingSubtaskId(null)
    setEditingSubtaskTitle('')
  }

  const handleEditSubtask = async (subtaskId: number) => {
    const title = editingSubtaskTitle.trim()
    if (!title || savingSubtaskId !== null) return
    setSavingSubtaskId(subtaskId)
    try {
      await api.patch(`/projects/${projectId}/tasks/${taskId}/subtasks/${subtaskId}`, { title })
      cancelEditingSubtask()
      await refreshTask()
      onUpdated()
      toast.success('子任务已更新')
    } catch (err: any) {
      toast.error(errDetail(err, '更新子任务失败'))
    } finally {
      setSavingSubtaskId(null)
    }
  }

  const handleDeleteSubtask = async (subtaskId: number, title: string) => {
    if (!(await confirmAction({
      title: '删除子任务',
      description: `「${title}」将从当前任务中永久移除。`,
      confirmLabel: '删除子任务',
      tone: 'danger',
      icon: 'delete',
    }))) return
    setDeletingSubtaskId(subtaskId)
    try {
      await api.delete(`/projects/${projectId}/tasks/${taskId}/subtasks/${subtaskId}`)
      if (editingSubtaskId === subtaskId) cancelEditingSubtask()
      await refreshTask()
      onUpdated()
      toast.success('子任务已删除')
    } catch (err: any) {
      toast.error(errDetail(err, '删除子任务失败'))
    } finally {
      setDeletingSubtaskId(null)
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
        milestone_ids: editMilestoneIds,
      }
      if (editDueDate) {
        payload.due_date = new Date(editDueDate).toISOString()
      } else {
        payload.due_date = null
      }
      await api.put(`/projects/${projectId}/tasks/${taskId}`, payload)
      setIsEditing(false)
      descriptionTaskReference.close()
      await Promise.all([refreshTask(), refreshReferences()])
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

  const handleDelete = async () => {
    if (!task) return
    if (!(await confirmAction({
      title: '删除任务',
      description: `「${task.title}」及其评论、子任务和附件将被永久删除。`,
      confirmLabel: '删除任务',
      tone: 'danger',
      icon: 'delete',
    }))) return
    setDeleting(true)
    try {
      await api.delete(`/projects/${projectId}/tasks/${taskId}`)
      toast.success('任务已删除')
      onUpdated()
      onClose()
    } catch (err: any) {
      toast.error(errDetail(err, '删除任务失败'))
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <Dialog open onClose={onClose} className="max-w-2xl overflow-hidden">
        <div className="flex min-h-72 flex-col items-center justify-center border-y border-border px-6 py-12 text-sm text-muted-foreground">
          <Loader2 className="mb-3 h-6 w-6 animate-spin text-primary" />
          正在读取任务上下文
        </div>
      </Dialog>
    )
  }

  if (error || !task) {
    return (
      <Dialog open onClose={onClose} className="max-w-xl overflow-hidden">
        <DialogHeader className="relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-1 bg-danger" aria-hidden="true" />
          <DialogTitle showClose onClose={onClose} className="flex items-center gap-2 text-xl">
            <AlertTriangle className="h-5 w-5 text-danger" />
            无法打开任务
          </DialogTitle>
          <DialogDescription>{error || '任务不存在或无权访问'}</DialogDescription>
        </DialogHeader>
        <div className="px-6 py-6">
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
  const descriptionReferences = references.outgoing
    .filter((reference) => reference.source_type === 'description')
    .map((reference) => reference.task)
  const uniqueOutgoing = Array.from(
    new Map(references.outgoing.map((reference) => [reference.task.id, reference.task])).values(),
  )
  const renderComment = (comment: TaskComment, isReply = false) => {
    const isOwn = currentUser?.id === comment.user_id
    const canDeleteComment = isOwn || canDelete || currentUser?.is_superuser
    const isEditingComment = editingCommentId === comment.id
    const parent = comment.parent_comment_id == null
      ? null
      : commentThreads.byId.get(comment.parent_comment_id)
    const wasEdited = Boolean(
      comment.updated_at
      && Math.abs(new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime()) >= 1000,
    )

    return (
      <div
        key={comment.id}
        id={`task-comment-${comment.id}`}
        className={cn(
          'group relative flex gap-2.5 px-1 py-2.5 transition-colors',
          isReply && 'py-2',
          focusCommentId === comment.id && 'rounded-[6px] bg-primary/[0.06]',
        )}
      >
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary',
            isReply ? 'mt-0.5 h-6 w-6 text-[10px]' : 'h-7 w-7 text-xs',
          )}
          aria-hidden="true"
        >
          {(comment.user?.display_name || '?').slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pr-20 sm:pr-0">
            <span className="whitespace-nowrap text-xs font-medium">{comment.user?.display_name}</span>
            {parent && (
              <span className="max-w-36 truncate text-xs text-muted-foreground">
                回复 {parent.user?.display_name}
              </span>
            )}
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
              {new Date(comment.created_at).toLocaleString('zh-CN')}
            </span>
            {wasEdited && (
              <span className="whitespace-nowrap text-[11px] text-muted-foreground/70">已编辑</span>
            )}
            {!isViewer && !isEditingComment && (
              <span className="absolute right-0 top-2 flex items-center gap-0.5 opacity-100 transition-opacity sm:static sm:ml-auto sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <button
                type="button"
                onClick={() => {
                  setReplyingToCommentId(comment.id)
                  requestAnimationFrame(() => commentInputRef.current?.focus())
                }}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={`回复 ${comment.user?.display_name || '评论'}`}
                title="回复"
              >
                <Reply className="h-3.5 w-3.5" />
              </button>
              {isOwn && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCommentId(comment.id)
                    setEditingCommentContent(comment.content)
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="编辑评论"
                  title="编辑"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
              )}
              {canDeleteComment && (
                <button
                  type="button"
                  onClick={() => handleDeleteComment(comment.id)}
                  disabled={deletingCommentId === comment.id}
                  className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                  aria-label="删除评论"
                  title="删除"
                >
                  {deletingCommentId === comment.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              </span>
            )}
          </div>
          {isEditingComment ? (
            <div className="relative space-y-2">
            <Textarea
              ref={editingCommentInputRef}
              rows={3}
              value={editingCommentContent}
              onChange={(event) => {
                setEditingCommentContent(event.target.value)
                editingCommentTaskReference.updateQuery(
                  event.target.value,
                  event.target.selectionStart ?? event.target.value.length,
                )
              }}
              onKeyDown={(event) => { editingCommentTaskReference.handleKeyDown(event) }}
              onBlur={editingCommentTaskReference.close}
              disabled={savingComment}
              className="text-sm"
            />
            {editingCommentTaskReference.open && (
              <TaskReferenceMenu
                tasks={editingCommentTaskReference.candidates}
                activeIndex={editingCommentTaskReference.activeIndex}
                onChoose={editingCommentTaskReference.choose}
                onActiveIndexChange={editingCommentTaskReference.setActiveIndex}
                className="left-0 top-20 mt-1"
              />
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingCommentId(null)
                  setEditingCommentContent('')
                }}
                disabled={savingComment}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => handleEditComment(comment.id)}
                disabled={savingComment || !editingCommentContent.trim()}
                loading={savingComment}
              >
                保存
              </Button>
            </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
              <MentionText
                content={comment.content}
                members={members}
                taskReferences={references.outgoing
                  .filter((reference) => reference.source_type === 'comment' && reference.source_comment_id === comment.id)
                  .map((reference) => reference.task)}
              />
            </p>
          )}
        </div>
      </div>
    )
  }

  const renderCommentThread = (node: CommentNode, isReply = false) => {
    const { comment, replies } = node
    return (
      <div key={comment.id}>
        {renderComment(comment, isReply)}
        {replies.length > 0 && (
          <div className="ml-3.5 space-y-0.5 border-l border-border/70 pl-3.5">
            {replies.map((reply) => renderCommentThread(reply, true))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Dialog open onClose={onClose} className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-hidden">
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
      <DialogHeader className="relative flex-none overflow-hidden px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
        <span className={cn('absolute inset-y-0 left-0 w-1', task.is_completed ? 'bg-success' : 'bg-primary')} aria-hidden="true" />
        <div className="flex items-start gap-3">
          <span className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-[8px]', task.is_completed ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary')}>
            <ListTodo className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${window.location.origin}/project/${projectId}/board?task=${task.id}`)
                  .then(() => toast.success('任务链接已复制'))
                  .catch(() => toast.error('复制任务链接失败'))
              }}
              className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              title="复制任务链接"
            >
              <span className="tnum">#{task.id}</span>
              <Copy className="h-3 w-3" aria-hidden="true" />
            </button>
            <DialogTitle
              showClose
              onClose={onClose}
              className={cn('text-xl leading-tight', !isEditing && task.is_completed && 'line-through text-muted-foreground')}
            >
              {isEditing ? '编辑任务' : task.title}
            </DialogTitle>
            {isEditing && (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                disabled={saving}
                placeholder="任务标题"
                className="mt-3 h-11 bg-background text-base font-semibold"
              />
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSuggestStatus}
                    disabled={suggestingStatus || saving || !editTitle.trim()}
                    loading={suggestingStatus}
                    className="h-8 gap-1 text-xs"
                    title="让 AI 根据任务标题和描述建议状态列"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    AI 建议状态
                  </Button>
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
                  {task.is_completed && (
                    <Badge variant="success" className="gap-1">
                      已完成
                    </Badge>
                  )}
                  {task.priority > 0 && (
                    <Badge variant={priority.variant}>
                      <AlertCircle className="mr-1 h-3 w-3" />
                      {priority.label}
                    </Badge>
                  )}
                  <AssigneePicker
                    members={members}
                    value={task.assignees.map((a) => a.id)}
                    onChange={handleAssigneeChange}
                    disabled={updatingAssignee || isEditing || isViewer}
                  />

                  {task.due_date && (
                    <Badge variant={isOverdue ? 'danger' : 'secondary'} className="gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(task.due_date).toLocaleDateString('zh-CN')}
                    </Badge>
                  )}

                  <Badge variant="secondary" className="gap-1">
                    <ListTodo className="h-3 w-3" />
                    {task.subtask_done}/{task.subtask_count}
                  </Badge>

                  <Badge variant="secondary" className="gap-1">
                    <MessageSquare className="h-3 w-3" />
                    {task.comment_count}
                  </Badge>
                </>
              )}
            </div>

            {!isEditing && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>创建于 {new Date(task.created_at).toLocaleString('zh-CN')}</span>
                <span>更新于 {new Date(task.updated_at).toLocaleString('zh-CN')}</span>
              </div>
            )}
          </div>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
        {/* Description */}
        <div className="space-y-2">
          <h4 className={SECTION_TITLE}>描述</h4>
          {isEditing ? (
            <div className="relative">
              <Textarea
                ref={descriptionInputRef}
                rows={5}
                value={editDescription}
                onChange={(e) => {
                  setEditDescription(e.target.value)
                  descriptionTaskReference.updateQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)
                }}
                onKeyDown={(e) => { descriptionTaskReference.handleKeyDown(e) }}
                onBlur={descriptionTaskReference.close}
                disabled={saving}
                placeholder="任务描述，输入 # 可引用任务"
              />
              {descriptionTaskReference.open && (
                <TaskReferenceMenu
                  tasks={descriptionTaskReference.candidates}
                  activeIndex={descriptionTaskReference.activeIndex}
                  onChoose={descriptionTaskReference.choose}
                  onActiveIndexChange={descriptionTaskReference.setActiveIndex}
                  className="left-0 top-full mt-1"
                />
              )}
            </div>
          ) : (
            task.description ? (
              <MarkdownContent
                content={task.description}
                className="rounded-lg bg-muted/30 px-4 py-3"
                taskReferences={descriptionReferences}
              />
            ) : (
              <p className="px-1 text-sm italic text-muted-foreground/70">无描述</p>
            )
          )}
        </div>

        <Separator />

        {(uniqueOutgoing.length > 0 || references.incoming.length > 0) && (
          <>
            <div className="space-y-3">
              <h4 className={cn(SECTION_TITLE, 'flex items-center gap-1.5')}>
                <Link2 className="h-4 w-4" />
                关联任务
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="mb-1.5 text-xs text-muted-foreground">引用了</p>
                  {uniqueOutgoing.length > 0 ? (
                    <div className="divide-y divide-border border-y border-border">
                      {uniqueOutgoing.map((target) => (
                        <Link
                          key={target.id}
                          to={`/project/${target.project_id}/board?task=${target.id}`}
                          className="flex min-w-0 items-center gap-2 py-2 text-sm hover:text-primary"
                        >
                          <span className="tnum flex-none text-xs text-muted-foreground">#{target.id}</span>
                          <span className={cn('truncate', target.is_completed && 'line-through text-muted-foreground')}>{target.title}</span>
                        </Link>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">无</p>}
                </div>
                <div className="min-w-0">
                  <p className="mb-1.5 text-xs text-muted-foreground">被引用于</p>
                  {references.incoming.length > 0 ? (
                    <div className="divide-y divide-border border-y border-border">
                      {references.incoming.map((reference, index) => (
                        <Link
                          key={`${reference.source_type}-${reference.source_comment_id ?? 'description'}-${reference.task.id}-${index}`}
                          to={`/project/${reference.task.project_id}/board?task=${reference.task.id}${reference.source_comment_id ? `&comment=${reference.source_comment_id}` : ''}`}
                          className="flex min-w-0 items-center gap-2 py-2 text-sm hover:text-primary"
                        >
                          <span className="tnum flex-none text-xs text-muted-foreground">#{reference.task.id}</span>
                          <span className="min-w-0 flex-1 truncate">{reference.task.title}</span>
                          <span className="flex-none text-[10px] text-muted-foreground">
                            {reference.source_type === 'comment' ? '评论' : '描述'}
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">无</p>}
                </div>
              </div>
            </div>
            <Separator />
          </>
        )}

        <div className="space-y-3">
          <h4 className={cn(SECTION_TITLE, 'flex items-center gap-1.5')}>
            <Flag className="h-4 w-4" />
            里程碑
          </h4>
          {isEditing ? (
            <MilestonePicker
              milestones={milestones}
              value={editMilestoneIds}
              onChange={setEditMilestoneIds}
              disabled={saving}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {milestones.filter((milestone) => task.milestone_ids.includes(milestone.id)).length ? (
                milestones
                  .filter((milestone) => task.milestone_ids.includes(milestone.id))
                  .map((milestone) => (
                    <span key={milestone.id} className="inline-flex min-h-7 items-center gap-1.5 rounded-[6px] border border-primary/20 bg-primary/[0.06] px-2.5 text-xs font-medium text-primary">
                      <Flag className="h-3.5 w-3.5" />{milestone.title}
                    </span>
                  ))
              ) : (
                <p className="text-sm text-muted-foreground">未关联里程碑</p>
              )}
            </div>
          )}
        </div>

        <Separator />

        {/* Subtasks */}
        <div className="space-y-3">
          <h4 className={cn(SECTION_TITLE, 'flex items-center gap-1.5')}>
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
                <div
                  key={sub.id}
                  className="group flex min-h-11 items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-accent/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={sub.is_completed}
                    onChange={() => handleSubtaskComplete(sub.id, sub.is_completed)}
                    disabled={isViewer || savingSubtaskId === sub.id || deletingSubtaskId === sub.id}
                    aria-label={`${sub.is_completed ? '取消完成' : '完成'}子任务「${sub.title}」`}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="tnum flex-none text-[10px] text-muted-foreground">#{sub.id}</span>
                  {editingSubtaskId === sub.id ? (
                    <>
                      <Input
                        value={editingSubtaskTitle}
                        onChange={(event) => setEditingSubtaskTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void handleEditSubtask(sub.id)
                          } else if (event.key === 'Escape') {
                            cancelEditingSubtask()
                          }
                        }}
                        disabled={savingSubtaskId === sub.id}
                        aria-label="编辑子任务标题"
                        className="h-8 min-w-0 flex-1 text-sm"
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => void handleEditSubtask(sub.id)}
                        disabled={!editingSubtaskTitle.trim() || savingSubtaskId === sub.id}
                        loading={savingSubtaskId === sub.id}
                        aria-label="保存子任务"
                        title="保存"
                      >
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={cancelEditingSubtask}
                        disabled={savingSubtaskId === sub.id}
                        aria-label="取消编辑子任务"
                        title="取消"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className={cn(
                        'min-w-0 flex-1 break-words text-sm',
                        sub.is_completed ? 'line-through text-muted-foreground' : 'text-foreground',
                      )}>
                        {sub.title}
                      </span>
                      {!isViewer && (
                        <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => startEditingSubtask(sub.id, sub.title)}
                            disabled={deletingSubtaskId === sub.id}
                            aria-label={`编辑子任务「${sub.title}」`}
                            title="编辑"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-danger hover:text-danger"
                            onClick={() => void handleDeleteSubtask(sub.id, sub.title)}
                            disabled={deletingSubtaskId === sub.id}
                            loading={deletingSubtaskId === sub.id}
                            aria-label={`删除子任务「${sub.title}」`}
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
          {!isViewer && (
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
                className="text-sm flex-1 min-w-0"
              />
              <Button
                onClick={handleAddSubtask}
                disabled={addingSubtask || !newSubtaskTitle.trim()}
                loading={addingSubtask}
                aria-label="添加子任务"
                className="shrink-0"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <Separator />

        {/* Attachments */}
        <div className="space-y-3">
          <h4 className={cn(SECTION_TITLE, 'flex items-center gap-1.5')}>
            <Paperclip className="h-4 w-4" />
            附件 ({attachments.length})
          </h4>
          <div className="space-y-1.5">
            {attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">暂无附件</p>
            ) : (
              attachments.map((a) => {
                const canDeleteAttachment =
                  a.uploader_id === currentUser?.id || canDelete || currentUser?.is_superuser
                return (
                  <div
                    key={a.id}
                    className="group flex items-center gap-3 rounded-lg border border-border p-2.5"
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{a.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.size < 1024 * 1024
                          ? `${(a.size / 1024).toFixed(1)} KB`
                          : `${(a.size / 1024 / 1024).toFixed(1)} MB`}
                        {' · '}
                        {new Date(a.created_at).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownloadAttachment(a)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                      aria-label="下载附件"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    {canDeleteAttachment && !isViewer && (
                      <button
                        type="button"
                        onClick={() => handleDeleteAttachment(a)}
                        disabled={deletingAttachmentId === a.id}
                        className="rounded p-1 text-muted-foreground hover:text-danger hover:bg-danger/10"
                        aria-label="删除附件"
                      >
                        {deletingAttachmentId === a.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
          {!isViewer && (
            <div>
              <input
                ref={attachmentInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleUploadAttachment(file)
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={uploadingAttachment}
                loading={uploadingAttachment}
                className="gap-1.5"
              >
                <Paperclip className="h-4 w-4" />
                上传附件（最大 20MB）
              </Button>
            </div>
          )}
        </div>

        <Separator />

        {/* Comments */}
        <div className="space-y-3">
          <h4 className={cn(SECTION_TITLE, 'flex items-center gap-1.5')}>
            <MessageSquare className="h-4 w-4" />
            评论 ({task.comments?.length || 0})
          </h4>
          <div className="overflow-hidden rounded-[8px] border border-border bg-muted/[0.06]">
            <div
              role="region"
              aria-label="评论列表"
              tabIndex={0}
              className="max-h-[44dvh] space-y-3 overflow-y-auto overscroll-contain px-3 py-2 pr-3.5 scrollbar-thin [scrollbar-gutter:stable] sm:max-h-[28rem]"
            >
              {(task.comments || []).length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">暂无评论</p>
              ) : (
                commentThreads.threads.map((node) => renderCommentThread(node))
              )}
            </div>
            {!isViewer && (
              <div className="relative flex flex-wrap gap-2 border-t border-border bg-background p-2">
              {replyingToComment && (
                <div className="flex w-full items-center gap-2 border-l-2 border-primary/50 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  <Reply className="h-3.5 w-3.5 text-primary" />
                  <span className="min-w-0 flex-1 truncate">
                    回复 {replyingToComment.user?.display_name}：{replyingToComment.content}
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyingToCommentId(null)}
                    className="rounded p-1 hover:bg-accent hover:text-foreground"
                    aria-label="取消回复"
                    title="取消回复"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {commentTaskReference.open ? (
                <TaskReferenceMenu
                  tasks={commentTaskReference.candidates}
                  activeIndex={commentTaskReference.activeIndex}
                  onChoose={commentTaskReference.choose}
                  onActiveIndexChange={commentTaskReference.setActiveIndex}
                  className="bottom-full left-0 mb-1"
                />
              ) : mentionCandidates.length > 0 && (
                <div
                  role="listbox"
                  aria-label="提及成员"
                  className="absolute bottom-full left-0 z-10 mb-1 w-56 overflow-hidden rounded-lg border border-border bg-popover shadow-md"
                >
                  {mentionCandidates.map((m) => (
                    <button
                      key={m.user_id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        insertMention(m.username)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <span className="font-medium text-foreground">{m.display_name}</span>
                      <span className="truncate text-xs text-muted-foreground">@{m.username}</span>
                    </button>
                  ))}
                </div>
              )}
              <Input
                ref={commentInputRef}
                value={newComment}
                onChange={(e) => {
                  setNewComment(e.target.value)
                  updateMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)
                  commentTaskReference.updateQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)
                }}
                onKeyDown={(e) => {
                  if (commentTaskReference.handleKeyDown(e)) return
                  if (e.key === 'Escape') {
                    setMentionQuery(null)
                    commentTaskReference.close()
                    return
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    if (mentionCandidates.length > 0) {
                      e.preventDefault()
                      insertMention(mentionCandidates[0].username)
                    } else {
                      handleAddComment()
                    }
                  }
                }}
                onBlur={() => {
                  setMentionQuery(null)
                  commentTaskReference.close()
                }}
                disabled={addingComment}
                placeholder={replyingToComment ? '输入回复，@ 提及成员，# 引用任务' : '输入评论，@ 提及成员，# 引用任务'}
                className="text-sm flex-1 min-w-0"
              />
              <Button
                onClick={handleAddComment}
                disabled={addingComment || !newComment.trim()}
                loading={addingComment}
                className="shrink-0 whitespace-nowrap"
              >
                发送
              </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <DialogFooter className="flex-none px-5 sm:px-7">
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
          <>
            {canDelete && (
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={deleting}
                loading={deleting}
                className="gap-1.5 text-danger hover:text-danger hover:bg-danger/10"
              >
                <Trash2 className="h-4 w-4" />
                删除任务
              </Button>
            )}
            <div className="flex-1" />
            {!isViewer && (
              <Button variant="outline" onClick={() => setIsEditing(true)} className="gap-1.5">
                <Edit2 className="h-4 w-4" />
                编辑任务
              </Button>
            )}
          </>
        )}
      </DialogFooter>
      </div>
    </Dialog>
  )
}
