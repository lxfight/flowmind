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
import { Textarea } from '../ui/Textarea'
import { Badge } from '../ui/Badge'
import { MarkdownContent } from '../ui/MarkdownContent'
import api, { errDetail } from '../../utils/api'
import toast from 'react-hot-toast'
import { FileText, Layers, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { confirmAction } from '../ui/confirmAction'

interface Doc {
  id: number
  title: string
  content: string
  file_type: string
  chunk_count: number
  status: 'parsing' | 'indexing' | 'indexed' | 'failed'
  error_message: string | null
  created_at: string
  updated_at: string
}

interface Chunk {
  id: number
  seq: number
  content: string
  has_embedding: boolean
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
  const [reindexing, setReindexing] = useState(false)
  const [showChunks, setShowChunks] = useState(false)
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [chunksTotal, setChunksTotal] = useState(0)
  const [chunksPage, setChunksPage] = useState(1)
  const [chunksLoading, setChunksLoading] = useState(false)
  const CHUNKS_PAGE_SIZE = 20

  const loadDoc = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const res = await api.get(`/projects/${projectId}/knowledge/${docId}`)
      const data = res.data as Doc
      setDoc(data)
      setEditTitle(data.title)
      setEditContent(data.content)
    } catch (err: any) {
      if (!silent) setError(errDetail(err, '加载文档失败'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [projectId, docId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: async loader updates state after await
    loadDoc()
  }, [loadDoc])

  // Poll while the doc is still being parsed/indexed. Poll silently so the
  // dialog doesn't flash a loading spinner over readable content every 3s.
  useEffect(() => {
    if (!doc || (doc.status !== 'indexing' && doc.status !== 'parsing')) return
    const timer = setInterval(() => {
      loadDoc(true)
    }, 3000)
    return () => clearInterval(timer)
  }, [doc, loadDoc])

  const loadChunks = async (page = 1) => {
    setChunksLoading(true)
    try {
      const res = await api.get(`/projects/${projectId}/knowledge/${docId}/chunks`, {
        params: { page, page_size: CHUNKS_PAGE_SIZE },
      })
      setChunks(res.data.items)
      setChunksTotal(res.data.total)
      setChunksPage(res.data.page)
    } catch (err: any) {
      toast.error(errDetail(err, '加载切片失败'))
    } finally {
      setChunksLoading(false)
    }
  }

  const handleReindex = async () => {
    if (!doc || reindexing) return
    setReindexing(true)
    try {
      const res = await api.post(`/projects/${projectId}/knowledge/${docId}/reindex`)
      setDoc(res.data as Doc)
      onUpdated()
      toast.success('已开始重建索引')
    } catch (err: any) {
      toast.error(errDetail(err, '重建索引失败'))
    } finally {
      setReindexing(false)
    }
  }

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
      toast.error(errDetail(err, '保存文档失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!doc) return
    if (!(await confirmAction({
      title: '删除知识文档',
      description: `「${doc.title}」及其索引片段将被永久删除。`,
      confirmLabel: '删除文档',
      tone: 'danger',
      icon: 'delete',
    }))) return
    setDeleting(true)
    try {
      await api.delete(`/projects/${projectId}/knowledge/${docId}`)
      toast.success('文档已删除')
      onUpdated()
      onClose()
    } catch (err: any) {
      toast.error(errDetail(err, '删除文档失败'))
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
    <Dialog open onClose={onClose} className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-hidden">
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
      <DialogHeader className="relative flex-none overflow-hidden px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
        <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
        <DialogTitle showClose onClose={onClose} className="text-xl leading-tight">
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
              <FileText className="h-4 w-4" aria-hidden="true" />
            </span>
            {isEditing ? '编辑文档' : '文档详情'}
          </span>
        </DialogTitle>
        <DialogDescription className="pl-[46px]">
          {loading
            ? '正在加载文档...'
            : doc
            ? `${doc.file_type.toUpperCase()} · ${doc.chunk_count} 个片段 · ${new Date(doc.updated_at).toLocaleString('zh-CN')} 更新`
            : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
        {loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center border-y border-border">
            <Loader2 className="mb-3 h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">正在读取文档</p>
          </div>
        ) : error ? (
          <div className="border-y border-danger/30 bg-danger/5 px-4 py-5 text-sm text-danger">
            {error}
          </div>
        ) : doc ? (
          <div className="space-y-4">
            {doc.status === 'failed' && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                索引失败{doc.error_message ? `：${doc.error_message}` : ''}
              </div>
            )}
            {(doc.status === 'indexing' || doc.status === 'parsing') && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在索引，完成后将自动更新…
              </div>
            )}
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
                <div className="border-b border-border pb-4">
                  <p className="text-[10px] font-semibold text-muted-foreground">DOCUMENT</p>
                  <h3 className="mt-1 text-2xl font-semibold leading-tight">{doc.title}</h3>
                </div>
                {doc.content ? (
                  <MarkdownContent content={doc.content} className="py-2" />
                ) : (
                  <div className="border-y border-dashed border-border py-8 text-center text-sm text-muted-foreground">暂无文档内容</div>
                )}
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      const next = !showChunks
                      setShowChunks(next)
                      if (next && chunks.length === 0) loadChunks(1)
                    }}
                  >
                    <Layers className="h-4 w-4" />
                    {showChunks ? '收起切片' : `查看切片（${doc.chunk_count}）`}
                  </Button>
                  {showChunks && (
                    <div className="mt-3 space-y-2">
                      {chunksLoading ? (
                        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          加载切片中...
                        </div>
                      ) : chunks.length === 0 ? (
                        <p className="py-2 text-sm text-muted-foreground">暂无切片</p>
                      ) : (
                        <>
                          {chunks.map((c) => (
                            <div key={c.id} className="rounded-lg border border-border bg-muted/30 p-3">
                              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>#{c.seq}</span>
                                <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                  {c.has_embedding ? '已向量化' : '纯文本'}
                                </Badge>
                              </div>
                              <pre className="whitespace-pre-wrap text-sm text-foreground font-mono leading-relaxed">{c.content}</pre>
                            </div>
                          ))}
                          {chunksTotal > CHUNKS_PAGE_SIZE && (
                            <div className="flex items-center justify-center gap-3 pt-1">
                              <Button variant="outline" size="sm" disabled={chunksPage <= 1} onClick={() => loadChunks(chunksPage - 1)}>
                                上一页
                              </Button>
                              <span className="text-xs text-muted-foreground">
                                第 {chunksPage} / {Math.ceil(chunksTotal / CHUNKS_PAGE_SIZE)} 页
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={chunksPage >= Math.ceil(chunksTotal / CHUNKS_PAGE_SIZE)}
                                onClick={() => loadChunks(chunksPage + 1)}
                              >
                                下一页
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      {!loading && !error && doc && (
        <DialogFooter className="flex-none px-5 sm:px-7">
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
                    onClick={handleReindex}
                    disabled={reindexing || doc.status === 'indexing' || doc.status === 'parsing'}
                    loading={reindexing}
                    className="gap-1.5"
                  >
                    <RefreshCw className="h-4 w-4" />
                    重建索引
                  </Button>
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
      </div>
    </Dialog>
  )
}
