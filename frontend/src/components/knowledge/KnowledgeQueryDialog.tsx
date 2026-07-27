import { useState } from 'react'
import { ArrowUpRight, BookOpen, Loader2, Search, Send, Sparkles } from 'lucide-react'
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
import { MarkdownContent } from '../ui/MarkdownContent'

interface Props {
  projectId: number
  onClose: () => void
}

interface Source {
  title: string
  relevance: number
  vector_score: number | null
  keyword_score: number | null
}

function scoreText(s: Source): string {
  const parts: string[] = []
  if (s.vector_score !== null && s.vector_score !== undefined) {
    parts.push(`向量 ${(s.vector_score * 100).toFixed(0)}%`)
  }
  if (s.keyword_score !== null && s.keyword_score !== undefined) {
    parts.push(`关键词 ${(s.keyword_score * 100).toFixed(0)}%`)
  }
  return parts.length > 0 ? parts.join(' · ') : `相关度 ${(s.relevance * 100).toFixed(0)}%`
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
    <Dialog open onClose={onClose} className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-hidden">
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
      <DialogHeader className="relative flex-none overflow-hidden px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
        <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
        <DialogTitle showClose onClose={onClose} className="text-xl leading-tight">
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary text-primary-foreground">
              <Search className="h-4 w-4" aria-hidden="true" />
            </span>
            知识库问答
          </span>
        </DialogTitle>
        <DialogDescription className="pl-[46px]">项目文档语义检索</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
        <div className="flex gap-2 border-y border-border py-4">
          <Search className="ml-1 mt-3 h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleQuery()}
            placeholder="输入关于项目的问题"
            autoFocus
            className="h-11 border-x-0 border-t-0 bg-transparent text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
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
          <div className="border-y border-border py-12 text-center">
            <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-primary" />
            <p className="body-text">正在查询知识库...</p>
          </div>
        )}

        {answer && !loading && (
          <div className="space-y-4">
            <section className="border-y border-primary/20 bg-primary/[0.035] px-5 py-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
                <BookOpen className="h-3.5 w-3.5" />
                知识库回答
              </div>
              <MarkdownContent content={answer} />
            </section>

            {sources.length > 0 ? (
              <div>
                <h4 className="text-sm font-medium mb-2">参考来源</h4>
                <div className="space-y-1">
                  {sources.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-border/70 px-1 py-2 text-sm last:border-b-0"
                    >
                      <span className="truncate pr-2">{s.title}</span>
                      <Badge variant="secondary" className="text-[10px] h-5 flex-shrink-0">
                        {scoreText(s)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="border-y border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                知识库中未找到相关内容
              </div>
            )}
          </div>
        )}

        {!answer && !loading && (
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              推荐问题
            </div>
            <div className="divide-y divide-border border-y border-border">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuestion(q)}
                  className="group flex w-full items-center justify-between gap-3 px-2 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted/30"
                >
                  <span>{q}</span>
                  <ArrowUpRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      </div>
    </Dialog>
  )
}
