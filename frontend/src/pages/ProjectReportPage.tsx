import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, RefreshCw, Calendar, History, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import api from '../utils/api'
import toast from 'react-hot-toast'

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
    // Load from cache
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
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold dark:text-gray-100">项目报告</h3>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <button
              className="btn-secondary text-sm flex items-center gap-1.5"
              onClick={() => setShowHistory(!showHistory)}
            >
              <History size={14} />
              历史
            </button>
          )}
          <button
            className="btn-primary flex items-center gap-1.5 text-sm"
            onClick={generateReport}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? '生成中...' : report ? '重新生成' : '生成报告'}
          </button>
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium dark:text-gray-200">历史报告</h4>
            <button className="text-xs text-gray-400 hover:text-red-500" onClick={clearHistory}>
              <Trash2 size={13} />
            </button>
          </div>
          <div className="space-y-1">
            {history.map((h, i) => (
              <button
                key={i}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm flex items-center justify-between"
                onClick={() => loadFromHistory(h)}
              >
                <span className="flex items-center gap-1.5 dark:text-gray-300">
                  <Calendar size={13} className="text-gray-400" />
                  {new Date(h.generated_at).toLocaleString('zh-CN')}
                </span>
                <span className="text-xs text-gray-400">
                  {h.report.substring(0, 40)}...
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!report && !loading && (
        <div className="card p-12 text-center">
          <FileText size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 dark:text-gray-300 mb-2">生成项目报告</h3>
          <p className="text-gray-400 dark:text-gray-500">
            点击"生成报告"按钮，LLM 将基于项目任务和近期动态自动生成进度报告
          </p>
        </div>
      )}

      {loading && (
        <div className="card p-12 text-center">
          <RefreshCw size={32} className="mx-auto text-primary-500 animate-spin mb-4" />
          <p className="text-gray-500 dark:text-gray-400">正在调用 LLM 生成报告...</p>
        </div>
      )}

      {report && (
        <div className="card p-6 max-w-3xl">
          {generatedAt && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 mb-4">
              <Calendar size={12} />
              生成时间: {new Date(generatedAt).toLocaleString('zh-CN')}
            </div>
          )}
          <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 leading-relaxed">
            <ReactMarkdown>{report}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
