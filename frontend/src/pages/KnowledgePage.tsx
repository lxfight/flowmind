import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, FileText, Loader2, MessageSquare, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import api from '../utils/api'
import { KnowledgeQueryDialog } from '../components/knowledge/KnowledgeQueryDialog'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { Card, CardContent } from '../components/ui/Card'
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
  created_at: string
}

export default function KnowledgePage() {
  const { projectId } = useParams()
  const [docs, setDocs] = useState<Doc[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showQuery, setShowQuery] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [docsLoading, setDocsLoading] = useState(true)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadDocs = useCallback(async () => {
    if (!projectId) return
    setDocsLoading(true)
    setDocsError(null)
    try {
      const res = await api.get(`/projects/${projectId}/knowledge`)
      setDocs(res.data)
    } catch (err: any) {
      setDocsError('知识库加载失败')
      toast.error(err.response?.data?.detail || '加载知识库失败')
    } finally {
      setDocsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadDocs()
  }, [loadDocs])

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
      toast.success('文档已添加')
      await loadDocs()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '保存失败')
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
      await loadDocs()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const handleFileUpload = async (file: File) => {
    if (!projectId) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post(`/projects/${projectId}/knowledge/upload`, formData)
      const chunkCount = res.data?.chunk_count
      toast.success(chunkCount ? `文件已上传并入库，共 ${chunkCount} 个片段` : '文件已上传并入库')
      await loadDocs()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '文件上传失败')
    } finally {
      setUploading(false)
    }
  }

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
  }, [projectId])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0])
      e.target.value = ''
    }
  }

  return (
    <div className="page-container h-full">
      <div className="flex items-center justify-between mb-6">
        <h3 className="section-title">知识库</h3>
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
          <Button
            size="sm"
            onClick={() => setShowCreate(!showCreate)}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            添加文档
          </Button>
        </div>
      </div>

      {/* File upload drop zone */}
      <Card
        className={cn(
          'mb-6 cursor-pointer border-2 border-dashed bg-transparent text-center transition-colors',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-accent/30'
        )}
        onDragEnter={handleDragIn}
        onDragLeave={handleDragOut}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <CardContent className="flex flex-col items-center gap-2 py-8">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.pptx,.xlsx,.html,.md,.txt,.csv,.json,.xml,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.wav,.mp3,.zip"
            onChange={handleFileSelect}
          />
          {uploading ? (
            <>
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-sm text-foreground">正在解析文件...</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-foreground">
                拖拽文件到此处上传，或<span className="text-primary font-medium">点击选择</span>
              </p>
              <p className="text-xs text-muted-foreground">
                支持 PDF、Word、PPT、Excel、HTML、Markdown 等格式
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Create form */}
      {showCreate && (
        <Card className="mb-6">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">新文档</label>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowCreate(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="文档标题"
            />
            <Textarea
              rows={8}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="文档内容（Markdown 格式）"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>取消</Button>
              <Button size="sm" onClick={handleCreate} disabled={loading || !newTitle.trim()} loading={loading}>
                保存
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Document list */}
      {docsLoading ? (
        <Card className="p-12 text-center">
          <Loader2 className="mx-auto h-8 w-8 text-primary animate-spin mb-4" />
          <p className="body-text">正在加载知识库...</p>
        </Card>
      ) : docsError ? (
        <Card className="p-12 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-danger mb-4" />
          <p className="text-sm text-foreground mb-4">{docsError}</p>
          <Button variant="outline" size="sm" onClick={loadDocs} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            重试
          </Button>
        </Card>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="知识库为空"
          description="上传项目文档，LLM 将基于这些内容回答项目相关问题"
          action={
            <Button size="sm" onClick={() => setShowCreate(true)}>添加文档</Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <Card key={doc.id} className="group">
              <CardContent className="flex items-start justify-between gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                    <h4 className="font-medium truncate">{doc.title}</h4>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 flex-shrink-0">
                      .{doc.file_type}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{doc.content}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{doc.chunk_count} 个片段</span>
                    <span>{new Date(doc.created_at).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-danger"
                  onClick={() => handleDelete(doc)}
                  disabled={deletingId === doc.id}
                >
                  {deletingId === doc.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
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
