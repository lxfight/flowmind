import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useProjectStore } from '../../stores/projectStore'
import { useThemeStore } from '../../stores/themeStore'
import { useEffect } from 'react'
import api from '../../utils/api'
import {
  LayoutDashboard,
  KanbanSquare,
  BookOpen,
  LogOut,
  Plus,
  Sun,
  Moon,
} from 'lucide-react'

export default function Layout() {
  const { user, logout, loadUser, token } = useAuthStore()
  const { projects, setProjects, currentProject, setCurrentProject } = useProjectStore()
  const { theme, toggle } = useThemeStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (token && !user) loadUser()
  }, [token])

  useEffect(() => {
    api.get('/projects').then((res) => setProjects(res.data))
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex flex-col">
        <div className="p-4 border-b dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-primary-600">FlowMind</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">智能任务管理</p>
            </div>
            <button
              onClick={toggle}
              className="btn-ghost p-1.5 rounded-lg"
              title={theme === 'light' ? '切换暗色模式' : '切换亮色模式'}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </div>

        {/* Projects */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">项目</span>
            <button className="btn-ghost p-1">
              <Plus size={16} />
            </button>
          </div>
          <nav className="space-y-1">
            {projects.map((p) => (
              <Link
                key={p.id}
                to={`/project/${p.id}/board`}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  currentProject?.id === p.id
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                onClick={() => setCurrentProject(p)}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
          </nav>
        </div>

        {/* User */}
        <div className="p-3 border-t dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2 px-3">
            <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 flex items-center justify-center text-sm font-medium">
              {user?.display_name?.charAt(0) || user?.username?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate dark:text-gray-200">{user?.display_name || user?.username}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900">
        <Outlet />
      </main>
    </div>
  )
}
