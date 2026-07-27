import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useProjectRole } from '../hooks/useProjectRole'
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import api, { errDetail } from '../utils/api'
import { KnowledgeQueryDialog } from '../components/knowledge/KnowledgeQueryDialog'
import { KnowledgeDocDialog } from '../components/knowledge/KnowledgeDocDialog'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../utils/cn'
import toast from 'react-hot-toast'

interface Doc {
  id: number
  title: string
  content: string
  file_type: string
  chunk_count: number
  status: 'parsing' | 'indexing' | 'indexed' | 'failed'
  error_message: string | null
  created_at: string
}

const DOCS_PAGE_SIZE = 20

export default function KnowledgePage() {
  const { projectId } = useParams()
  const userRole = useProjectRole()
  const canManageDocs = userRole !== 'viewer'
  const [docs, setDocs] = useState<Doc[]>([])
  const [docsTotal, setDocsTotal] = useState(0)
  const [docsPage, setDocsPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [showQuery, setShowQuery] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [docsLoading, setDocsLoading] = useState(true)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadDocs = useCallback(async (page: number, silent = false) => {
    if (!projectId) return
    if (!silent) {
      setDocsLoading(true)
      setDocsError(null)
    }
    try {
      const res = await api.get(`/projects/${projectId}/knowledge`, {
        params: { page, page_size: DOCS_PAGE_SIZE },
      })
      setDocs(res.data.items)
      setDocsTotal(res.data.total)
      setDocsPage(res.data.page)
    } catch (err: any) {
      if (!silent) {
        setDocsError('知识库加载失败')
        toast.error(errDetail(err, '加载知识库失败'))
      }
    } finally {
      if (!silent) setDocsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: async loader updates state after await
    loadDocs(1)
  }, [loadDocs])

  // Poll while any doc is still being parsed/indexed.
  useEffect(() => {
    const hasUnsettled = docs.some((d) => d.status === 'indexing' || d.status === 'parsing')
    if (!hasUnsettled) return
    const timer = setInterval(() => {
      loadDocs(docsPage, true)
    }, 3000)
    return () => clearInterval(timer)
  }, [docs, docsPage, loadDocs])

  const resetCreate = () => {
    setNewTitle('')
    setNewContent('')
    setShowCreate(false)
  }

  const handleCreate = async () => {
    if (!projectId || !newTitle.trim()) return
    setLoading(true)
    try {
      await api.post(`/projects/${projectId}/knowledge`, {
        title: newTitle,
        content: newContent,
      })
      resetCreate()
      toast.success('文档已添加，已开始索引')
      await loadDocs(docsPage)
    } catch (err: any) {
      toast.error(errDetail(err, '保存失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (doc: Doc) => {
    if (!projectId) return
    if (!confirm(`确定删除文档「${doc.title}」？`)) return
    setDeletingId(doc.id)
    try {
      await api.delete(`/projects/${projectId}/knowledge/${doc.id}`)
      toast.success('文档已删除')
      await loadDocs(docsPage)
    } catch (err: any) {
      toast.error(errDetail(err, '删除失败'))
    } finally {
      setDeletingId(null)
    }
  }

  const handleFileUpload = useCallback(async (file: File) => {
    if (!projectId) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post(`/projects/${projectId}/knowledge/upload`, formData)
      toast.success(res.data?.title ? `「${res.data.title}」已上传，已开始索引` : '文件已上传，已开始索引')
      await loadDocs(docsPage)
    } catch (err: any) {
      toast.error(errDetail(err, '文件上传失败'))
    } finally {
      setUploading(false)
    }
  }, [projectId, docsPage, loadDocs])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragOver(true)
    }
  }, [])

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0])
    }
  }, [handleFileUpload])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0])
      e.target.value = ''
    }
  }

  const indexedCount = docs.filter((doc) => doc.status === 'indexed').length
  const indexingCount = docs.filter((doc) => doc.status === 'indexing' || doc.status === 'parsing').length

  const DocStatusBadge = ({ doc }: { doc: Doc }) => {
    if (doc.status === 'indexing' || doc.status === 'parsing') {
      return (
        <Badge variant="secondary" className="gap-1.5 whitespace-nowrap py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          索引中
        </Badge>
      )
    }
    if (doc.status === 'failed') {
      return (
        <Badge variant="danger" className="gap-1.5 whitespace-nowrap py-1" title={doc.error_message || '索引失败'}>
          <AlertCircle className="h-3.5 w-3.5" />
          失败
        </Badge>
      )
    }
    return (
      <Badge variant="success" className="gap-1.5 whitespace-nowrap py-1">
        <CheckCircle2 className="h-3.5 w-3.5" />
        已索引
      </Badge>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">知识库</h1>
            <p className="mt-0.5 text-xs text-muted-foreground tnum">
              {docsTotal} 篇文档 · {indexedCount} 篇可检索{indexingCount > 0 ? ` · ${indexingCount} 篇处理中` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowQuery(true)}
            className="gap-1.5"
          >
            <MessageSquare className="h-4 w-4" />
            LLM 问答
          </Button>
          {canManageDocs && (
            <Button
              size="sm"
              onClick={() => setShowCreate(!showCreate)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              添加文档
            </Button>
          )}
        </div>
      </header>

      {canManageDocs && (
        <section
          role="button"
          tabIndex={0}
          aria-label="上传文件到知识库"
          className={cn(
            'mb-6 flex min-h-16 cursor-pointer items-center gap-3 border-y border-dashed px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/25'
          )}
          onDragEnter={handleDragIn}
          onDragLeave={handleDragOut}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.pptx,.xls,.xlsx,.html,.md,.txt,.csv,.json,.xml,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.wav,.mp3"
            onChange={handleFileSelect}
          />
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-muted text-muted-foreground">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Upload className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{uploading ? '正在上传文件' : '拖放或选择文件'}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">PDF、Office、Markdown、文本、图片与音频</p>
          </div>
          <span className="hidden text-xs font-medium text-primary sm:inline">选择文件</span>
        </section>
      )}

      {showCreate && canManageDocs && (
        <section className="mb-6 overflow-hidden rounded-md border border-border bg-card" aria-label="新建知识文档">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-foreground">新文档</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={resetCreate}
              aria-label="关闭新建文档"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-3 p-4">
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="文档标题" />
            <Textarea
              rows={7}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="文档内容（Markdown 格式）"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetCreate}>取消</Button>
              <Button size="sm" onClick={handleCreate} disabled={loading || !newTitle.trim()} loading={loading}>保存</Button>
            </div>
          </div>
        </section>
      )}

      {docsLoading ? (
        <div className="flex min-h-40 items-center justify-center gap-3 border-y border-border text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          正在加载知识库
        </div>
      ) : docsError ? (
        <div className="flex min-h-40 flex-col items-center justify-center border-y border-border text-center">
          <AlertCircle className="mb-3 h-7 w-7 text-danger" />
          <p className="mb-4 text-sm text-foreground">{docsError}</p>
          <Button variant="outline" size="sm" onClick={() => loadDocs(docsPage)} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            重试
          </Button>
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="知识库为空"
          description="当前项目还没有可检索文档"
        />
      ) : (
        <section className="overflow-hidden border-y border-border" aria-label="知识文档列表">
          <div className="hidden grid-cols-[minmax(0,1fr)_8rem_8rem_2.5rem] items-center gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[10px] font-semibold text-muted-foreground sm:grid">
            <span>文档</span>
            <span>索引状态</span>
            <span>文档信息</span>
            <span className="sr-only">操作</span>
          </div>
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border/75 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/25 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_2.5rem]"
            >
              <button
                className="flex min-w-0 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`查看文档 ${doc.title}`}
                onClick={() => setSelectedDocId(doc.id)}
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{doc.title}</span>
                    <Badge variant="secondary" className="h-5 flex-none px-1.5 text-[10px]">{doc.file_type.toUpperCase()}</Badge>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{doc.content || '无文本内容'}</span>
                  <span className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground sm:hidden">
                    <span>{doc.chunk_count} 个片段</span>
                    <span>{new Date(doc.created_at).toLocaleDateString('zh-CN')}</span>
                  </span>
                </span>
              </button>

              <div className="flex justify-end sm:justify-start">
                <DocStatusBadge doc={doc} />
              </div>

              <div className="hidden text-xs leading-5 text-muted-foreground sm:block">
                <span className="block">{doc.chunk_count} 个片段</span>
                <span className="block tnum">{new Date(doc.created_at).toLocaleDateString('zh-CN')}</span>
              </div>

              <div className="flex w-8 justify-end">
                {canManageDocs && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    onClick={() => handleDelete(doc)}
                    disabled={deletingId === doc.id}
                    aria-label={`删除 ${doc.title}`}
                    title="删除文档"
                  >
                    {deletingId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>
          ))}

          {docsTotal > DOCS_PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 border-t border-border px-3 py-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={docsPage <= 1}
                onClick={() => loadDocs(docsPage - 1)}
                aria-label="上一页"
                title="上一页"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-28 text-center text-xs text-muted-foreground tnum">
                {docsPage} / {Math.ceil(docsTotal / DOCS_PAGE_SIZE)} · {docsTotal} 篇
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={docsPage >= Math.ceil(docsTotal / DOCS_PAGE_SIZE)}
                onClick={() => loadDocs(docsPage + 1)}
                aria-label="下一页"
                title="下一页"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </section>
      )}

      {selectedDocId && (
        <KnowledgeDocDialog
          projectId={parseInt(projectId!)}
          docId={selectedDocId}
          canEdit={canManageDocs}
          onClose={() => setSelectedDocId(null)}
          onUpdated={() => loadDocs(docsPage)}
        />
      )}

      {showQuery && projectId && (
        <KnowledgeQueryDialog
          projectId={parseInt(projectId)}
          onClose={() => setShowQuery(false)}
        />
      )}
    </div>
  )
}
