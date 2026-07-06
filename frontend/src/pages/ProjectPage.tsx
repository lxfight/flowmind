import { useParams, Link, Outlet, useLocation } from 'react-router-dom'
import { useProjectStore } from '../stores/projectStore'
import { useEffect } from 'react'
import api from '../utils/api'
import { KanbanSquare, BookOpen, Users, FileText, Activity } from 'lucide-react'

export default function ProjectPage() {
  const { projectId } = useParams()
  const { currentProject, setCurrentProject } = useProjectStore()
  const location = useLocation()

  useEffect(() => {
    if (projectId) {
      api.get(`/projects/${projectId}`).then((res) => setCurrentProject(res.data))
    }
    return () => setCurrentProject(null)
  }, [projectId])

  if (!currentProject) return null

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
        <nav className="flex gap-1 mt-2">
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
