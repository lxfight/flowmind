import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, Search, FileText, Trash2, MessageSquare } from 'lucide-react'
import api from '../utils/api'
import { KnowledgeQueryDialog } from '../components/knowledge/KnowledgeQueryDialog'

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

  const loadDocs = async () => {
    if (!projectId) return
    const res = await api.get(`/projects/${projectId}/knowledge`)
    setDocs(res.data)
  }

  useEffect(() => {
    loadDocs()
  }, [projectId])

  const handleCreate = async () => {
    if (!projectId || !newTitle.trim()) return
    setLoading(true)
    await api.post(`/projects/${projectId}/knowledge`, {
      title: newTitle,
      content: newContent,
    })
    setNewTitle('')
    setNewContent('')
    setShowCreate(false)
    setLoading(false)
    loadDocs()
  }

  const handleDelete = async (docId: number) => {
    if (!projectId) return
    await api.delete(`/projects/${projectId}/knowledge/${docId}`)
    loadDocs()
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

      {/* Create form */}
      {showCreate && (
        <div className="card p-4 mb-6">
          <div className="space-y-3">
            <input
              className="input-field"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="文档标题"
            />
            <textarea
              className="input-field resize-none"
              rows={6}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="文档内容（Markdown 格式）"
            />
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button className="btn-primary" onClick={handleCreate} disabled={loading}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document list */}
      {docs.length === 0 ? (
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
                </div>
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{doc.content}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                  <span>{doc.chunk_count} 个片段</span>
                  <span>{new Date(doc.created_at).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
              <button
                className="btn-ghost p-2 text-gray-400 hover:text-red-500"
                onClick={() => handleDelete(doc.id)}
              >
                <Trash2 size={16} />
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
