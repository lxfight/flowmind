import { useState, useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, KanbanSquare, RefreshCw, CheckCircle, Clock, AlertTriangle } from 'lucide-react'
import { CreateProjectDialog } from '../components/project/CreateProjectDialog'
import api from '../utils/api'
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
  const { projects, setProjects, setCurrentProject } = useProjectStore()
  const user = useAuthStore((s) => s.user)
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<Record<number, ProjectStat>>({})
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    Promise.all([
      projects.length === 0 ? api.get('/projects').then(r => { setProjects(r.data); return r.data }) : Promise.resolve(projects),
      api.get('/projects/stats'),
    ])
      .then(([, statsRes]) => {
        const map: Record<number, ProjectStat> = {}
        statsRes.data.projects.forEach((s: ProjectStat) => (map[s.project_id] = s))
        setStats(map)
      })
      .catch(() => toast.error('加载失败'))
      .finally(() => setLoading(false))
  }, [])

  const handleCreateProject = async (data: { name: string; description: string; color: string }) => {
    try {
      const res = await api.post('/projects', data)
      setProjects([res.data, ...projects])
      toast.success('项目创建成功')
      navigate(`/project/${res.data.id}/board`)
    } catch {
      toast.error('创建失败')
    }
  }

  return (
    <div className="p-6 dark:text-gray-100">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold dark:text-gray-100">我的项目</h2>
        {(user?.can_create_project || user?.is_superuser) && (
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
            <Plus size={18} />
            新建项目
          </button>
        )}
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <RefreshCw size={32} className="mx-auto text-primary-500 animate-spin mb-4" />
          <p className="text-gray-500 dark:text-gray-400">加载项目列表...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="card p-12 text-center">
          <KanbanSquare size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 dark:text-gray-300 mb-2">还没有项目</h3>
          <p className="text-gray-400 dark:text-gray-500 mb-4">创建第一个项目，开始使用 FlowMind</p>
          {(user?.can_create_project || user?.is_superuser) && (
            <button className="btn-primary" onClick={() => setShowCreate(true)}>创建项目</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => {
            const stat = stats[p.id]
            const progress = stat && stat.total_tasks > 0
              ? Math.round((stat.completed_tasks / stat.total_tasks) * 100)
              : 0

            return (
              <Link
                key={p.id}
                to={`/project/${p.id}/board`}
                className="card p-5 hover:shadow-md transition-shadow"
                onClick={() => setCurrentProject(p)}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }} />
                  <h3 className="font-semibold text-lg dark:text-gray-100">{p.name}</h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-4">
                  {p.description || '暂无描述'}
                </p>

                {/* Stats */}
                {stat && (
                  <div className="space-y-2">
                    {/* Progress bar */}
                    {stat.total_tasks > 0 && (
                      <div>
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                          <span className="flex items-center gap-1">
                            <CheckCircle size={11} className="text-green-500" />
                            {stat.completed_tasks}/{stat.total_tasks} 完成
                          </span>
                          <span>{progress}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full transition-all duration-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {stat.total_tasks === 0 && (
                      <p className="text-xs text-gray-400">暂无任务</p>
                    )}

                    <div className="flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {stat.total_tasks} 个任务
                      </span>
                      {stat.overdue_tasks > 0 && (
                        <span className="flex items-center gap-1 text-red-500">
                          <AlertTriangle size={11} />
                          {stat.overdue_tasks} 个逾期
                        </span>
                      )}
                      <span>{stat.member_count} 位成员</span>
                    </div>
                  </div>
                )}

                {/* Fallback if no stats */}
                {!stat && (
                  <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                    <span>{p.member_count} 位成员</span>
                  </div>
                )}
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
    </div>
  )
}
