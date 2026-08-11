import { useState, useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, CheckCircle, Clock, KanbanSquare, MessageSquare, Plus, RefreshCw, Users } from 'lucide-react'
import { CreateProjectDialog } from '../components/project/CreateProjectDialog'
import { LLMChatPanel } from '../components/llm-chat/LLMChatPanel'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import api, { errDetail } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import { cn } from '../utils/cn'
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
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: loading flag before async fetch
    setStatsLoading(true)
    api.get('/projects/stats')
      .then((statsRes) => {
        if (cancelled) return
        const map: Record<number, ProjectStat> = {}
        statsRes.data.projects.forEach((s: ProjectStat) => (map[s.project_id] = s))
        setStats(map)
      })
      .catch(() => { if (!cancelled) toast.error('加载失败') })
      .finally(() => { if (!cancelled) setStatsLoading(false) })
    return () => {
      cancelled = true
    }
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

  const overview = Object.values(stats).reduce(
    (result, stat) => ({
      tasks: result.tasks + stat.total_tasks,
      completed: result.completed + stat.completed_tasks,
      overdue: result.overdue + stat.overdue_tasks,
    }),
    { tasks: 0, completed: 0, overdue: 0 },
  )
  const overallProgress = overview.tasks > 0 ? Math.round((overview.completed / overview.tasks) * 100) : 0

  return (
    <div className="mx-auto w-full max-w-[2000px]">
      <PageHeader
        title="我的项目"
        description="在一处观察所有项目的推进节奏、风险与协作状态。"
        actions={
          (user?.can_create_project || user?.is_superuser) && (
            <Button onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
          )
        }
      />

      {!statsLoading && projectsLoaded && projects.length > 0 && (
        <section className="mb-8 grid border-y border-border sm:grid-cols-2 lg:grid-cols-4" aria-label="项目概览">
          {[
            { label: '参与项目', value: projects.length, suffix: '', icon: KanbanSquare },
            { label: '任务总量', value: overview.tasks, suffix: '', icon: Clock },
            { label: '整体完成', value: overallProgress, suffix: '%', icon: CheckCircle },
            { label: '当前逾期', value: overview.overdue, suffix: '', icon: AlertTriangle },
          ].map((metric, index) => {
            const Icon = metric.icon
            return (
              <div key={metric.label} className="flex items-end justify-between gap-4 border-b border-border px-4 py-5 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground">{metric.label}</p>
                  <p className="tnum mt-2 text-3xl font-semibold leading-none text-foreground">
                    {String(metric.value).padStart(2, '0')}<span className="text-base text-muted-foreground">{metric.suffix}</span>
                  </p>
                </div>
                <Icon className={cn('h-4 w-4', index === 3 && overview.overdue > 0 ? 'text-danger' : 'text-muted-foreground')} />
              </div>
            )
          })}
        </section>
      )}

      {statsLoading || !projectsLoaded ? (
        <div className="border-y border-border p-12 text-center">
          <RefreshCw className="mx-auto h-8 w-8 text-primary animate-spin mb-4" />
          <p className="body-text">加载项目列表...</p>
        </div>
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 min-[1900px]:grid-cols-4">
          {projects.map((p, projectIndex) => {
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
                <Card hover className="relative h-full overflow-hidden" style={{ '--project-accent': p.color } as React.CSSProperties}>
                  <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: p.color }} aria-hidden="true" />
                  <CardContent className="p-5 pl-6">
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <span className="tnum text-[10px] font-semibold text-muted-foreground">PROJECT {String(projectIndex + 1).padStart(2, '0')}</span>
                        <h3 className="mt-1 truncate text-lg font-semibold text-foreground transition-colors group-hover:text-[var(--project-accent)]">{p.name}</h3>
                      </div>
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] bg-muted text-muted-foreground transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-foreground">
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </div>
                    <p className="mb-6 min-h-[2.5rem] line-clamp-2 text-sm leading-5 text-muted-foreground">
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

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-3 w-3" />
                            {stat.total_tasks} 个任务
                          </span>
                          {stat.overdue_tasks > 0 && (
                            <span className="inline-flex items-center gap-1.5 text-danger">
                              <AlertTriangle className="h-3 w-3" />
                              {stat.overdue_tasks} 个逾期
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1.5">
                            <Users className="h-3 w-3" />
                            {stat.member_count} 位成员
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5"><Users className="h-3 w-3" />{p.member_count} 位成员</span>
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
