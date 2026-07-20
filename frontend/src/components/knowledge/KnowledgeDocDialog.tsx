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
import { Badge } from '../ui/Badge'
import api from '../../utils/api'
import toast from 'react-hot-toast'
import { FileText, Loader2, Pencil, Trash2 } from 'lucide-react'

interface Doc {
  id: number
  title: string
  content: string
  file_type: string
  chunk_count: number
  created_at: string
  updated_at: string
}

interface Props {
  projectId: number
  docId: number
  canEdit: boolean
  onClose: () => void
  onUpdated: () => void
}

export function KnowledgeDocDialog({ projectId, docId, canEdit, onClose, onUpdated }: Props) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')

  const loadDoc = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/projects/${projectId}/knowledge/${docId}`)
      const data = res.data as Doc
      setDoc(data)
      setEditTitle(data.title)
      setEditContent(data.content)
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载文档失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDoc()
  }, [projectId, docId])

  const handleSave = async () => {
    if (!doc || !editTitle.trim() || saving) return
    setSaving(true)
    try {
      const res = await api.put(`/projects/${projectId}/knowledge/${docId}`, {
        title: editTitle.trim(),
        content: editContent,
      })
      setDoc(res.data as Doc)
      setIsEditing(false)
      onUpdated()
      toast.success('文档已保存')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '保存文档失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!doc) return
    if (!confirm(`确定删除文档「${doc.title}」？`)) return
    setDeleting(true)
    try {
      await api.delete(`/projects/${projectId}/knowledge/${docId}`)
      toast.success('文档已删除')
      onUpdated()
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '删除文档失败')
      setDeleting(false)
    }
  }

  const handleCancel = () => {
    if (doc) {
      setEditTitle(doc.title)
      setEditContent(doc.content)
    }
    setIsEditing(false)
  }

  return (
    <Dialog open onClose={onClose} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle showClose onClose={onClose} className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
          {isEditing ? '编辑文档' : '文档详情'}
        </DialogTitle>
        <DialogDescription>
          {loading
            ? '正在加载文档...'
            : doc
            ? `${doc.file_type.toUpperCase()} · ${doc.chunk_count} 个片段 · ${new Date(doc.updated_at).toLocaleString('zh-CN')} 更新`
            : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="px-6 pb-6 max-h-[65vh] overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-foreground">
            {error}
          </div>
        ) : doc ? (
          <div className="space-y-4">
            {isEditing ? (
              <>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="文档标题"
                  disabled={saving}
                  className="text-base font-semibold"
                />
                <Textarea
                  rows={18}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="文档内容（支持 Markdown）"
                  disabled={saving}
                  className="font-mono text-sm"
                />
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">{doc.title}</h3>
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <pre className="whitespace-pre-wrap text-sm text-foreground font-mono leading-relaxed">{doc.content || '（无内容）'}</pre>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      {!loading && !error && doc && (
        <DialogFooter className="flex-col-reverse sm:flex-row">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={saving}>取消</Button>
              <Button onClick={handleSave} disabled={saving || !editTitle.trim()} loading={saving}>
                保存
              </Button>
            </>
          ) : (
            <>
              {canEdit && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleDelete}
                    disabled={deleting}
                    loading={deleting}
                    className="gap-1.5 text-danger hover:text-danger hover:bg-danger/10 sm:mr-auto"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                  <div className="hidden sm:block flex-1" />
                  <Button
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                    className="gap-1.5"
                  >
                    <Pencil className="h-4 w-4" />
                    编辑
                  </Button>
                </>
              )}
            </>
          )}
        </DialogFooter>
      )}
    </Dialog>
  )
}
