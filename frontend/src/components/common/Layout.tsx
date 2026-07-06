import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useProjectStore } from '../../stores/projectStore'
import { useThemeStore } from '../../stores/themeStore'
import { useEffect, useState } from 'react'
import api from '../../utils/api'
import {
  Menu,
  X,
  LogOut,
  Plus,
  Sun,
  Moon,
  Shield,
  Settings,
} from 'lucide-react'

export default function Layout() {
  const { user, logout, loadUser, token } = useAuthStore()
  const { projects, setProjects, currentProject, setCurrentProject } = useProjectStore()
  const { theme, toggle } = useThemeStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

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

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="flex h-screen dark:bg-gray-900">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static z-30 h-full w-64 bg-white border-r border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-4 border-b dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-primary-600">FlowMind</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">智能任务管理</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggle}
                className="btn-ghost p-1.5 rounded-lg"
                title={theme === 'light' ? '切换暗色模式' : '切换亮色模式'}
              >
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              </button>
              <button className="btn-ghost p-1.5 lg:hidden" onClick={closeSidebar}>
                <X size={16} />
              </button>
            </div>
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
                onClick={() => { setCurrentProject(p); closeSidebar() }}
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

        {/* Admin link */}
        {user?.is_superuser && (
          <div className="px-3 pb-2">
            <Link
              to="/admin/users"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <Shield size={15} />
              用户管理
            </Link>
          </div>
        )}

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
          <Link
            to="/profile"
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Settings size={16} />
            个人设置
          </Link>
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
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-2 border-b dark:border-gray-700 bg-white dark:bg-gray-800">
          <button className="btn-ghost p-1.5" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <h1 className="font-bold text-primary-600">FlowMind</h1>
        </div>
        <Outlet />
      </main>
    </div>
  )
}
