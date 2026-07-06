import { useState, useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, KanbanSquare, RefreshCw } from 'lucide-react'
import { CreateProjectDialog } from '../components/project/CreateProjectDialog'
import api from '../utils/api'
import toast from 'react-hot-toast'

export default function DashboardPage() {
  const { projects, setProjects, setCurrentProject } = useProjectStore()
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (projects.length === 0) {
      setLoading(true)
      api.get('/projects')
        .then((res) => setProjects(res.data))
        .catch(() => toast.error('加载项目列表失败'))
        .finally(() => setLoading(false))
    }
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
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
          <Plus size={18} />
          新建项目
        </button>
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
          <button className="btn-primary" onClick={() => setShowCreate(true)}>创建项目</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
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
              <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-4">{p.description}</p>
              <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                <span>{p.member_count} 位成员</span>
              </div>
            </Link>
          ))}
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
