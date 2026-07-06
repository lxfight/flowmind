import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, FileText, Loader2, MessageSquare, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import api from '../utils/api'
import { KnowledgeQueryDialog } from '../components/knowledge/KnowledgeQueryDialog'
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

  const handleCreate = async () => {
    if (!projectId || !newTitle.trim()) return
    setLoading(true)
    try {
      await api.post(`/projects/${projectId}/knowledge`, {
        title: newTitle,
        content: newContent,
      })
      setNewTitle('')
      setNewContent('')
      setShowCreate(false)
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
    <div className="p-6 h-full">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">知识库</h3>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary flex items-center gap-1.5"
            onClick={() => setShowQuery(true)}
          >
            <MessageSquare size={16} />
            LLM 问答
          </button>
          <button
            className="btn-primary flex items-center gap-1.5"
            onClick={() => setShowCreate(!showCreate)}
          >
            <Plus size={16} />
            添加文档
          </button>
        </div>
      </div>

      {/* File upload drop zone */}
      <div
        className={`mb-6 border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
          dragOver
            ? 'border-primary-400 bg-primary-50'
            : 'border-gray-300 hover:border-gray-400 bg-gray-50 hover:bg-gray-100'
        }`}
        onDragEnter={handleDragIn}
        onDragLeave={handleDragOut}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.pptx,.xlsx,.html,.md,.txt,.csv,.json,.xml,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.wav,.mp3,.zip"
          onChange={handleFileSelect}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={32} className="text-primary-500 animate-spin" />
            <p className="text-sm text-gray-600">正在解析文件...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={32} className="text-gray-400" />
            <p className="text-sm text-gray-600">
              拖拽文件到此处上传，或<span className="text-primary-600">点击选择</span>
            </p>
            <p className="text-xs text-gray-400">
              支持 PDF、Word、PPT、Excel、HTML、Markdown 等格式
            </p>
          </div>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card p-4 mb-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">文档标题</label>
              <button className="btn-ghost p-1" onClick={() => setShowCreate(false)}>
                <X size={16} />
              </button>
            </div>
            <input
              className="input-field"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="文档标题"
            />
            <label className="text-sm font-medium">内容（Markdown 格式）</label>
            <textarea
              className="input-field resize-none"
              rows={10}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="文档内容（Markdown 格式）"
            />
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button className="btn-primary" onClick={handleCreate} disabled={loading}>
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document list */}
      {docsLoading ? (
        <div className="card p-12 text-center">
          <Loader2 size={32} className="mx-auto text-primary-500 animate-spin mb-4" />
          <p className="text-sm text-gray-500">正在加载知识库...</p>
        </div>
      ) : docsError ? (
        <div className="card p-12 text-center">
          <AlertCircle size={40} className="mx-auto text-red-500 mb-4" />
          <p className="text-sm text-gray-600 mb-4">{docsError}</p>
          <button className="btn-secondary inline-flex items-center gap-1.5" onClick={loadDocs}>
            <RefreshCw size={15} />
            重试
          </button>
        </div>
      ) : docs.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">知识库为空</h3>
          <p className="text-gray-400 mb-4">
            上传项目文档，LLM 将基于这些内容回答项目相关问题
          </p>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            添加文档
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <div key={doc.id} className="card p-4 flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-primary-500 flex-shrink-0" />
                  <h4 className="font-medium truncate">{doc.title}</h4>
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                    .{doc.file_type}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{doc.content}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                  <span>{doc.chunk_count} 个片段</span>
                  <span>{new Date(doc.created_at).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
              <button
                className="btn-ghost p-2 text-gray-400 hover:text-red-500"
                onClick={() => handleDelete(doc)}
                disabled={deletingId === doc.id}
              >
                {deletingId === doc.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Query Dialog */}
      {showQuery && projectId && (
        <KnowledgeQueryDialog
          projectId={parseInt(projectId)}
          onClose={() => setShowQuery(false)}
        />
      )}
    </div>
  )
}
