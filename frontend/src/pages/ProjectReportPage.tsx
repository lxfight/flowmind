import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, RefreshCw, Calendar } from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'

export default function ProjectReportPage() {
  const { projectId } = useParams()
  const [report, setReport] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const generateReport = async () => {
    if (!projectId) return
    setLoading(true)
    setReport(null)
    try {
      const res = await api.post(`/llm/report?project_id=${projectId}`)
      setReport(res.data.report)
      setGeneratedAt(res.data.generated_at)
    } catch {
      toast.error('报告生成失败，请检查 LLM 配置')
    }
    setLoading(false)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">项目报告</h3>
        <button
          className="btn-primary flex items-center gap-1.5"
          onClick={generateReport}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {loading ? '生成中...' : '生成报告'}
        </button>
      </div>

      {!report && !loading && (
        <div className="card p-12 text-center">
          <FileText size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">生成项目报告</h3>
          <p className="text-gray-400">
            点击"生成报告"按钮，LLM 将基于项目任务和近期动态自动生成进度报告
          </p>
        </div>
      )}

      {loading && (
        <div className="card p-12 text-center">
          <RefreshCw size={32} className="mx-auto text-primary-500 animate-spin mb-4" />
          <p className="text-gray-500">正在调用 LLM 生成报告...</p>
        </div>
      )}

      {report && (
        <div className="card p-6">
          {generatedAt && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
              <Calendar size={12} />
              生成时间: {new Date(generatedAt).toLocaleString('zh-CN')}
            </div>
          )}
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700 leading-relaxed">
            {report}
          </div>
        </div>
      )}
    </div>
  )
}
