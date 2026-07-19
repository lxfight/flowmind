import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, RefreshCw, Calendar, History, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import api from '../utils/api'
import toast from 'react-hot-toast'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../utils/cn'

interface ReportEntry {
  report: string
  generated_at: string
}

const CACHE_KEY = 'flowmind_report_cache'
const HISTORY_KEY = 'flowmind_report_history'

function loadCache(projectId: string): ReportEntry | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_KEY}_${projectId}`)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function saveCache(projectId: string, entry: ReportEntry) {
  try {
    sessionStorage.setItem(`${CACHE_KEY}_${projectId}`, JSON.stringify(entry))
  } catch {}
}

function loadHistory(projectId: string): ReportEntry[] {
  try {
    const raw = localStorage.getItem(`${HISTORY_KEY}_${projectId}`)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveHistory(projectId: string, entries: ReportEntry[]) {
  try {
    localStorage.setItem(`${HISTORY_KEY}_${projectId}`, JSON.stringify(entries.slice(0, 5)))
  } catch {}
}

export default function ProjectReportPage() {
  const { projectId } = useParams()
  const [report, setReport] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<ReportEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (!projectId) return
    setHistory(loadHistory(projectId))
    const cached = loadCache(projectId)
    if (cached) {
      setReport(cached.report)
      setGeneratedAt(cached.generated_at)
    }
  }, [projectId])

  const generateReport = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const res = await api.post(`/llm/report?project_id=${projectId}`)
      const entry: ReportEntry = { report: res.data.report, generated_at: res.data.generated_at }
      setReport(entry.report)
      setGeneratedAt(entry.generated_at)
      saveCache(projectId, entry)
      const newHistory = [entry, ...loadHistory(projectId).filter(h => h.generated_at !== entry.generated_at)]
      saveHistory(projectId, newHistory)
      setHistory(newHistory)
    } catch {
      toast.error('报告生成失败，请检查 LLM 配置')
    }
    setLoading(false)
  }

  const loadFromHistory = (entry: ReportEntry) => {
    if (!projectId) return
    setReport(entry.report)
    setGeneratedAt(entry.generated_at)
    saveCache(projectId, entry)
    setShowHistory(false)
  }

  const clearHistory = () => {
    if (!projectId) return
    setHistory([])
    saveHistory(projectId, [])
  }

  return (
    <div className="page-container h-full overflow-y-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h3 className="section-title">项目报告</h3>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              className="gap-1.5"
            >
              <History className="h-4 w-4" />
              历史
            </Button>
          )}
          <Button
            size="sm"
            onClick={generateReport}
            disabled={loading}
            loading={loading}
            className="gap-1.5"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {loading ? '生成中...' : report ? '重新生成' : '生成报告'}
          </Button>
        </div>
      </div>

      {showHistory && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">历史报告</h4>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-danger"
                onClick={clearHistory}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-1">
              {history.map((h, i) => (
                <button
                  key={i}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-3"
                  onClick={() => loadFromHistory(h)}
                >
                  <span className="flex items-center gap-1.5 text-foreground">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {new Date(h.generated_at).toLocaleString('zh-CN')}
                  </span>
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                    {h.report.substring(0, 40)}...
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!report && !loading && (
        <EmptyState
          icon={FileText}
          title="生成项目报告"
          description="点击“生成报告”按钮，LLM 将基于项目任务和近期动态自动生成进度报告"
          action={
            <Button size="sm" onClick={generateReport} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              生成报告
            </Button>
          }
        />
      )}

      {loading && !report && (
        <Card className="p-12 text-center">
          <RefreshCw className="mx-auto h-8 w-8 text-primary animate-spin mb-4" />
          <p className="body-text">正在调用 LLM 生成报告...</p>
        </Card>
      )}

      {report && (
        <Card className="max-w-3xl">
          <CardContent className="p-6">
            {generatedAt && (
              <div className="mb-4 flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <Calendar className="h-3 w-3" />
                  生成时间: {new Date(generatedAt).toLocaleString('zh-CN')}
                </Badge>
              </div>
            )}
            <div className="prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
              <ReactMarkdown>{report}</ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
