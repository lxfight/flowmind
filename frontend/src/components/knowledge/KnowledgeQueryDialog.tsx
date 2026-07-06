import { useState } from 'react'
import { X, Send, Search } from 'lucide-react'
import api from '../../utils/api'

interface Props {
  projectId: number
  onClose: () => void
}

interface Source {
  title: string
  relevance: number
}

export function KnowledgeQueryDialog({ projectId, onClose }: Props) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)

  const handleQuery = async () => {
    if (!question.trim() || loading) return
    setLoading(true)
    setAnswer(null)

    try {
      const res = await api.post(`/projects/${projectId}/knowledge/query`, {
        question: question.trim(),
      })
      setAnswer(res.data.answer)
      setSources(res.data.sources || [])
    } catch {
      setAnswer('查询失败，请重试。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <h3 className="text-lg font-semibold dark:text-gray-100 flex items-center gap-2">
            <Search size={18} className="text-primary-500" />
            知识库问答
          </h3>
          <button onClick={onClose} className="btn-ghost p-1">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Input */}
          <div className="flex gap-2 mb-4">
            <input
              className="input-field"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
              placeholder="输入关于项目的问题..."
              autoFocus
            />
            <button
              className="btn-primary"
              onClick={handleQuery}
              disabled={loading || !question.trim()}
            >
              <Send size={16} />
            </button>
          </div>

          {/* Loading */}
          {loading && (
            <div className="text-center py-8">
              <div className="animate-spin w-8 h-8 border-4 border-primary-200 dark:border-primary-700 border-t-primary-500 rounded-full mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">正在查询知识库...</p>
            </div>
          )}

          {/* Answer */}
          {answer && !loading && (
            <div className="space-y-4">
              <div className="card p-4 bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800">
                <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{answer}</p>
              </div>

              {/* Sources */}
              {sources.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">参考来源</h4>
                  <div className="space-y-1">
                    {sources.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 px-3 py-1.5 rounded-lg"
                      >
                        <span>{s.title}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          相关度: {(s.relevance * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Suggestions */}
          {!answer && !loading && (
            <div className="mt-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">试试这些问题：</p>
              <div className="flex flex-wrap gap-2">
                {[
                  '这个项目的技术选型是什么？',
                  '项目当前进展如何？',
                  '项目有哪些功能模块？',
                ].map((q) => (
                  <button
                    key={q}
                    className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"
                    onClick={() => {
                      setQuestion(q)
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
