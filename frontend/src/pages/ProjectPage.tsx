import { useParams, Link, Outlet, useLocation } from 'react-router-dom'
import { useProjectStore } from '../stores/projectStore'
import { useCallback, useEffect, useState } from 'react'
import api from '../utils/api'
import { Activity, AlertCircle, BookOpen, FileText, KanbanSquare, Loader2, RefreshCw, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { cn } from '../utils/cn'

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
        <Card className="p-10 text-center">
          <Loader2 className="mx-auto h-7 w-7 text-primary animate-spin mb-3" />
          <p className="body-text">正在加载项目...</p>
        </Card>
      </div>
    )
  }

  if (error || !currentProject) {
    return (
      <div className="p-6">
        <Card className="p-10 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-danger mb-3" />
          <p className="text-sm text-foreground mb-4">{error || '项目不存在或无权访问'}</p>
          <Button variant="outline" size="sm" onClick={loadProject} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            重试
          </Button>
        </Card>
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
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card px-6 py-3">
        <div className="flex items-center gap-3">
          <span
            className="h-4 w-4 rounded-full flex-shrink-0"
            style={{ backgroundColor: currentProject.color }}
          />
          <h2 className="text-xl font-bold text-foreground">{currentProject.name}</h2>
          <span className="text-sm text-muted-foreground ml-2 hidden sm:inline truncate max-w-md">
            {currentProject.description}
          </span>
        </div>
        <nav className="mt-2 flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.path)
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors whitespace-nowrap',
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
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
