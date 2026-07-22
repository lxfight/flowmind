import { useState, useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, KanbanSquare, RefreshCw, CheckCircle, Clock, AlertTriangle, MessageSquare } from 'lucide-react'
import { CreateProjectDialog } from '../components/project/CreateProjectDialog'
import { LLMChatPanel } from '../components/llm-chat/LLMChatPanel'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import api, { errDetail } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'

interface ProjectStat {
  project_id: number
  project_name: string
  color: string
  total_tasks: number
  completed_tasks: number
  overdue_tasks: number
  member_count: number
}

export default function DashboardPage() {
  const { projects, setProjects, setCurrentProject, loaded: projectsLoaded } = useProjectStore()
  const user = useAuthStore((s) => s.user)
  const [showCreate, setShowCreate] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [stats, setStats] = useState<Record<number, ProjectStat>>({})
  const navigate = useNavigate()

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: loading flag before async fetch
    setStatsLoading(true)
    api.get('/projects/stats')
      .then((statsRes) => {
        const map: Record<number, ProjectStat> = {}
        statsRes.data.projects.forEach((s: ProjectStat) => (map[s.project_id] = s))
        setStats(map)
      })
      .catch(() => toast.error('加载失败'))
      .finally(() => setStatsLoading(false))
  }, [])

  const handleCreateProject = async (data: { name: string; description: string; color: string }) => {
    try {
      const res = await api.post('/projects', data)
      setProjects([res.data, ...projects])
      toast.success('项目创建成功')
      navigate(`/project/${res.data.id}/board`)
    } catch (err: any) {
      toast.error(errDetail(err, '创建失败'))
      throw err
    }
  }

  return (
    <div className="mx-auto w-full max-w-[2000px]">
      <PageHeader
        title="我的项目"
        description="管理你参与的所有项目"
        actions={
          (user?.can_create_project || user?.is_superuser) && (
            <Button onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
          )
        }
      />

      {statsLoading || !projectsLoaded ? (
        <Card className="p-12 text-center">
          <RefreshCw className="mx-auto h-8 w-8 text-primary animate-spin mb-4" />
          <p className="body-text">加载项目列表...</p>
        </Card>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title="还没有项目"
          description="创建第一个项目，开始使用 FlowMind"
          action={
            (user?.can_create_project || user?.is_superuser) && (
              <Button onClick={() => setShowCreate(true)}>创建项目</Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1900px]:grid-cols-5 gap-4">
          {projects.map((p) => {
            const stat = stats[p.id]
            const rawProgress = stat && stat.total_tasks > 0
              ? Math.round((stat.completed_tasks / stat.total_tasks) * 100)
              : 0
            const progress = Math.min(100, Math.max(0, rawProgress))

            return (
              <Link
                key={p.id}
                to={`/project/${p.id}/board`}
                className="block group"
                onClick={() => setCurrentProject(p)}
              >
                <Card hover className="h-full" style={{ '--project-accent': p.color } as React.CSSProperties}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <span
                        className="h-4 w-4 rounded-full flex-shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <h3 className="card-title truncate transition-colors group-hover:text-[var(--project-accent)]">{p.name}</h3>
                    </div>
                    <p className="body-text line-clamp-2 mb-4 min-h-[2.5rem]">
                      {p.description || '暂无描述'}
                    </p>

                    {stat ? (
                      <div className="space-y-3">
                        {stat.total_tasks > 0 ? (
                          <div>
                            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                              <span className="tnum flex items-center gap-1">
                                <CheckCircle className="h-3 w-3 text-success" />
                                {stat.completed_tasks}/{stat.total_tasks} 完成
                              </span>
                              <span className="tnum">{progress}%</span>
                            </div>
                            <div
                              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                              role="progressbar"
                              aria-label="项目完成进度"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={progress}
                            >
                              <div
                                className="h-full rounded-full bg-success transition-all duration-500"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">暂无任务</p>
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="gap-1">
                            <Clock className="h-3 w-3" />
                            {stat.total_tasks} 个任务
                          </Badge>
                          {stat.overdue_tasks > 0 && (
                            <Badge variant="danger" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {stat.overdue_tasks} 个逾期
                            </Badge>
                          )}
                          <Badge variant="outline">{stat.member_count} 位成员</Badge>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <Badge variant="outline">{p.member_count} 位成员</Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {showCreate && (
        <CreateProjectDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateProject}
        />
      )}

      {/* 跨项目 LLM 助手浮动窗口（projectId null = 聚合所有项目；
          不传 members —— 成员跨多项目，@ 补全在跨项目模式下禁用） */}
      <LLMChatPanel
        projectId={null}
        open={showChat}
        onClose={() => setShowChat(false)}
      />

      {/* Floating trigger when the assistant panel is collapsed */}
      {!showChat && (
        <button
          type="button"
          onClick={() => setShowChat(true)}
          aria-label="打开跨项目助手"
          className="fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-transform duration-200 hover:scale-105"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}
