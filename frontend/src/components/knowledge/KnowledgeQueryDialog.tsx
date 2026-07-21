import { useState } from 'react'
import { Send, Search } from 'lucide-react'
import api from '../../utils/api'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { Card, CardContent } from '../ui/Card'

interface Props {
  projectId: number
  onClose: () => void
}

interface Source {
  title: string
  relevance: number
}

const SUGGESTIONS = [
  '这个项目的技术选型是什么？',
  '项目当前进展如何？',
  '项目有哪些功能模块？',
]

export function KnowledgeQueryDialog({ projectId, onClose }: Props) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)

  const handleQuery = async () => {
    if (!question.trim() || loading) return
    setLoading(true)
    setAnswer(null)
    setSources([])

    try {
      const res = await api.post(`/projects/${projectId}/knowledge/query`, {
        question: question.trim(),
      })
      setAnswer(res.data.answer)
      setSources(res.data.sources || [])
    } catch {
      setAnswer('查询失败，请重试。')
      setSources([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle showClose onClose={onClose} className="flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          知识库问答
        </DialogTitle>
        <DialogDescription>向项目知识库提问，获取基于文档的回答。</DialogDescription>
      </DialogHeader>

      <div className="px-6 pb-6 max-h-[60vh] overflow-y-auto space-y-4">
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleQuery()}
            placeholder="输入关于项目的问题..."
            autoFocus
          />
          <Button
            size="icon"
            aria-label="查询"
            onClick={handleQuery}
            disabled={loading || !question.trim()}
            loading={loading}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {loading && (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
            <p className="body-text">正在查询知识库...</p>
          </div>
        )}

        {answer && !loading && (
          <div className="space-y-4">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <p className="text-sm text-foreground whitespace-pre-wrap">{answer}</p>
              </CardContent>
            </Card>

            {sources.length > 0 ? (
              <div>
                <h4 className="text-sm font-medium mb-2">参考来源</h4>
                <div className="space-y-1">
                  {sources.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5 text-sm"
                    >
                      <span className="truncate pr-2">{s.title}</span>
                      <Badge variant="secondary" className="text-[10px] h-5 flex-shrink-0">
                        相关度: {(s.relevance * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                知识库中未找到相关内容
              </div>
            )}
          </div>
        )}

        {!answer && !loading && (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-2">试试这些问题：</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((q) => (
                <Button
                  key={q}
                  variant="secondary"
                  size="sm"
                  onClick={() => setQuestion(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
