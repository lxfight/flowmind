import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertCircle,
  CalendarDays,
  FileText,
  History,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import api, { errDetail } from '../utils/api'
import toast from 'react-hot-toast'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { MarkdownContent } from '../components/ui/MarkdownContent'
import { cn } from '../utils/cn'

interface ReportEntry {
  id: number
  project_id: number
  report: string
  generated_at: string
}

const REPORT_REQUEST_TIMEOUT_MS = 190_000
const pendingReportRequests = new Map<string, Promise<ReportEntry>>()

class InvalidReportResponseError extends Error {}

function parseReportEntry(value: unknown): ReportEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  if (typeof entry.id !== 'number' || typeof entry.project_id !== 'number') return null
  if (typeof entry.report !== 'string' || !entry.report.trim()) return null
  if (typeof entry.generated_at !== 'string' || Number.isNaN(Date.parse(entry.generated_at))) return null
  return {
    id: entry.id,
    project_id: entry.project_id,
    report: entry.report,
    generated_at: entry.generated_at,
  }
}

function parseReportHistory(value: unknown): ReportEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map(parseReportEntry)
    .filter((entry): entry is ReportEntry => entry !== null)
}

function reportErrorMessage(err: unknown) {
  const isTimeout = Boolean(
    err && typeof err === 'object' && (err as Record<string, unknown>).code === 'ECONNABORTED',
  )
  const fallback = err instanceof InvalidReportResponseError
    ? '模型返回的报告格式无效，请重试'
    : isTimeout
      ? '报告生成超时，请稍后重试'
      : '报告生成失败，请稍后重试'
  return errDetail(err, fallback)
}

function startReportGeneration(projectId: string) {
  const pending = pendingReportRequests.get(projectId)
  if (pending) return pending

  const request = api.post(`/llm/report?project_id=${projectId}`, undefined, {
    // The backend owns a 180s total retry budget; leave a small transport margin.
    timeout: REPORT_REQUEST_TIMEOUT_MS,
  }).then((response) => {
    const entry = parseReportEntry(response.data)
    if (!entry) throw new InvalidReportResponseError('Invalid report response')
    return entry
  }).finally(() => {
    if (pendingReportRequests.get(projectId) === request) {
      pendingReportRequests.delete(projectId)
    }
  })

  pendingReportRequests.set(projectId, request)
  return request
}

export default function ProjectReportPage() {
  const { projectId } = useParams()
  const [report, setReport] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [reportsLoading, setReportsLoading] = useState(true)
  const [reportsError, setReportsError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [loading, setLoading] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [history, setHistory] = useState<ReportEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const activeProjectRef = useRef(projectId)

  useEffect(() => {
    activeProjectRef.current = projectId
    if (!projectId) return
    let cancelled = false
    const pending = pendingReportRequests.get(projectId)

    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating project-scoped server state
    setHistory([])
    setReport(null)
    setGeneratedAt(null)
    setReportsLoading(true)
    setReportsError(null)
    setLoading(Boolean(pending))
    setGenerationError(null)
    setShowHistory(false)

    const hydrate = async () => {
      try {
        const response = await api.get(`/llm/report?project_id=${projectId}`)
        if (cancelled) return
        const entries = parseReportHistory(response.data)
        setHistory(entries)
        setReport(entries[0]?.report ?? null)
        setGeneratedAt(entries[0]?.generated_at ?? null)
      } catch (err: unknown) {
        if (!cancelled) setReportsError(errDetail(err, '共享报告加载失败，请稍后重试'))
      } finally {
        if (!cancelled) setReportsLoading(false)
      }

      if (!pending) return
      try {
        const entry = await pending
        if (cancelled) return
        setReport(entry.report)
        setGeneratedAt(entry.generated_at)
        setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 5))
        setGenerationError(null)
      } catch (err: unknown) {
        if (!cancelled) setGenerationError(reportErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void hydrate()

    return () => {
      cancelled = true
      if (activeProjectRef.current === projectId) activeProjectRef.current = undefined
    }
  }, [projectId, reloadToken])

  const generateReport = async () => {
    if (!projectId) return
    const requestedProjectId = projectId
    setLoading(true)
    setGenerationError(null)
    try {
      const entry = await startReportGeneration(requestedProjectId)
      if (activeProjectRef.current !== requestedProjectId) return
      setReport(entry.report)
      setGeneratedAt(entry.generated_at)
      setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 5))
    } catch (err: unknown) {
      if (activeProjectRef.current !== requestedProjectId) return
      const message = reportErrorMessage(err)
      setGenerationError(message)
      toast.error(message)
    } finally {
      if (activeProjectRef.current === requestedProjectId) setLoading(false)
    }
  }

  const loadFromHistory = (entry: ReportEntry) => {
    if (!projectId) return
    setReport(entry.report)
    setGeneratedAt(entry.generated_at)
    setShowHistory(false)
  }

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">项目报告</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {loading ? '数据汇总与内容生成中' : generatedAt ? `更新于 ${new Date(generatedAt).toLocaleString('zh-CN')}` : '暂无报告记录'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory((visible) => !visible)}
              className="gap-1.5"
              aria-expanded={showHistory}
            >
              <History className="h-4 w-4" />
              历史
            </Button>
          )}
          <Button
            size="sm"
            onClick={generateReport}
            disabled={loading || reportsLoading}
            loading={loading}
            className="gap-1.5"
          >
            {!loading && (report ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />)}
            {loading ? '生成中' : report ? '重新生成' : '生成报告'}
          </Button>
        </div>
      </header>

      {showHistory && (
        <section className="mb-6 overflow-hidden border-y border-border" aria-label="历史报告">
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">项目共享的最近 {history.length} 份报告</span>
          </div>
          {history.map((entry) => (
            <button
              key={entry.id}
              className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-b border-border/75 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/25"
              onClick={() => loadFromHistory(entry)}
            >
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground tnum">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(entry.generated_at).toLocaleString('zh-CN')}
              </span>
              <span className="truncate text-xs text-muted-foreground">{entry.report.replace(/[#*_`]/g, '').slice(0, 80)}</span>
            </button>
          ))}
        </section>
      )}

      {generationError && (
        <div className="mb-6 flex items-center justify-between gap-3 border-y border-danger/25 bg-danger/5 px-3 py-3 text-sm text-danger" role="alert">
          <span className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-none" />
            <span className="truncate">{generationError}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={generateReport} className="flex-none text-danger">
            重试
          </Button>
        </div>
      )}

      {reportsError && (
        <div className="mb-6 flex items-center justify-between gap-3 border-y border-danger/25 bg-danger/5 px-3 py-3 text-sm text-danger" role="alert">
          <span className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-none" />
            <span className="truncate">{reportsError}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setReloadToken((value) => value + 1)} className="flex-none text-danger">
            重新加载
          </Button>
        </div>
      )}

      {loading && (
        <div className="mb-6 overflow-hidden border-y border-primary/20 bg-primary/[0.035] px-3 py-4" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="relative flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
              <RefreshCw className="h-4 w-4 animate-spin" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">正在生成项目报告</p>
              <p className="mt-0.5 text-xs text-muted-foreground">整理任务、进度与近期动态</p>
            </div>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-primary/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/60" />
          </div>
        </div>
      )}

      {reportsLoading && !loading && (
        <div className="py-16 text-center text-sm text-muted-foreground" aria-live="polite">
          正在加载项目共享报告…
        </div>
      )}

      {!report && !loading && !reportsLoading && (
        <EmptyState
          icon={FileText}
          title="尚未生成报告"
          description="当前项目还没有报告记录"
        />
      )}

      {report && (
        <article className="mx-auto max-w-4xl border-y border-border px-1 py-7 sm:px-5">
          {generatedAt && (
            <div className="mb-6 flex items-center justify-between gap-3 border-b border-border pb-4">
              <Badge variant="secondary" className="gap-1.5 py-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {new Date(generatedAt).toLocaleString('zh-CN')}
              </Badge>
              {loading && <span className="text-xs text-muted-foreground">正在准备新版本</span>}
            </div>
          )}
          <MarkdownContent
            content={report}
            className={cn(
              'text-[15px] leading-7 [&_h1]:text-2xl [&_h1]:leading-tight [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-2 [&_h2]:text-xl [&_h3]:mt-6 [&_p]:my-3 [&_pre]:my-4 [&_table]:text-sm',
              loading && 'opacity-70',
            )}
          />
        </article>
      )}
    </div>
  )
}
