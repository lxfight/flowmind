import { useParams, Link, Outlet, useLocation } from 'react-router-dom'
import { useProjectStore } from '../stores/projectStore'
import { useCallback, useEffect, useState } from 'react'
import api from '../utils/api'
import { Activity, AlertCircle, BookOpen, FileText, KanbanSquare, Loader2, RefreshCw, Users } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ProjectPage() {
  const { projectId } = useParams()
  const { currentProject, setCurrentProject } = useProjectStore()
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadProject = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    setCurrentProject(null)
    try {
      const res = await api.get(`/projects/${projectId}`)
      setCurrentProject(res.data)
    } catch {
      setError('项目加载失败')
      toast.error('加载项目失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, setCurrentProject])

  useEffect(() => {
    loadProject()
    return () => setCurrentProject(null)
  }, [loadProject, setCurrentProject])

  if (loading) {
    return (
      <div className="p-6">
        <div className="card p-10 text-center">
          <Loader2 size={28} className="mx-auto mb-3 text-primary-500 animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">正在加载项目...</p>
        </div>
      </div>
    )
  }

  if (error || !currentProject) {
    return (
      <div className="p-6">
        <div className="card p-10 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500" />
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{error || '项目不存在或无权访问'}</p>
          <button className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={loadProject}>
            <RefreshCw size={15} />
            重试
          </button>
        </div>
      </div>
    )
  }

  const navItems = [
    { path: `/project/${projectId}/board`, label: '看板', icon: KanbanSquare },
    { path: `/project/${projectId}/knowledge`, label: '知识库', icon: BookOpen },
    { path: `/project/${projectId}/activities`, label: '动态', icon: Activity },
    { path: `/project/${projectId}/members`, label: '成员', icon: Users },
    { path: `/project/${projectId}/report`, label: '报告', icon: FileText },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Project header */}
      <div className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 px-6 py-3">
        <div className="flex items-center gap-3">
          <span
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: currentProject.color }}
          />
          <h2 className="text-xl font-bold dark:text-gray-100">{currentProject.name}</h2>
          <span className="text-sm text-gray-400 dark:text-gray-500 ml-2">{currentProject.description}</span>
        </div>
        <nav className="flex gap-1 mt-2 overflow-x-auto pb-1">
          {navItems.map((item) => {
            const active = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  active
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
