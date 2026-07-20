import { useParams, Outlet } from 'react-router-dom'
import { useProjectStore } from '../stores/projectStore'
import { useCallback, useEffect, useState } from 'react'
import api from '../utils/api'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ProjectHeader } from '../components/layout/ProjectHeader'
import { Card } from '../components/ui/Card'

export default function ProjectPage() {
  const { projectId } = useParams()
  const { currentProject, setCurrentProject } = useProjectStore()
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
      <div className="p-2">
        <Card className="p-10 text-center">
          <Loader2 className="mx-auto h-7 w-7 text-primary animate-spin mb-3" />
          <p className="body-text">正在加载项目...</p>
        </Card>
      </div>
    )
  }

  if (error || !currentProject) {
    return (
      <div className="p-2">
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

  return (
    <div className="flex flex-col min-h-full">
      <ProjectHeader project={currentProject} />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
