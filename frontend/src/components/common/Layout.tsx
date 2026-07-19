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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from '../ui/Sheet'
import { Button } from '../ui/Button'
import { Avatar } from '../ui/Avatar'
import { cn } from '../../utils/cn'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const { projects, setProjects, currentProject, setCurrentProject } = useProjectStore()
  const { theme, toggle } = useThemeStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    api.get('/projects').then((res) => setProjects(res.data))
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const SidebarContent = () => (
    <>
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-primary">FlowMind</h1>
            <p className="text-xs text-muted-foreground mt-0.5">智能任务管理</p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggle}
              title={theme === 'light' ? '切换暗色模式' : '切换亮色模式'}
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭侧边栏"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">项目</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => navigate('/dashboard')}
            aria-label="新建项目"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <nav className="space-y-1">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/project/${p.id}/board`}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                currentProject?.id === p.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-accent'
              )}
              onClick={() => { setCurrentProject(p); setSidebarOpen(false) }}
            >
              <span
                className="h-3 w-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
        </nav>
      </div>

      {user?.is_superuser && (
        <div className="px-3 pb-2">
          <Link
            to="/admin/users"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent transition-colors"
            onClick={() => setSidebarOpen(false)}
          >
            <Shield className="h-4 w-4" />
            用户管理
          </Link>
        </div>
      )}

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 mb-2 px-3">
          <Avatar
            name={user?.display_name || user?.username || 'User'}
            size="sm"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.display_name || user?.username}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
        <Link
          to="/profile"
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent rounded-lg transition-colors"
          onClick={() => setSidebarOpen(false)}
        >
          <Settings className="h-4 w-4" />
          个人设置
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent rounded-lg transition-colors"
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex z-30 h-full w-64 border-r border-border bg-card flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile Sheet Sidebar */}
      <Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} side="left" className="w-[280px] lg:hidden">
        <SheetHeader className="sr-only">
          <SheetTitle>导航菜单</SheetTitle>
          <SheetClose onClose={() => setSidebarOpen(false)} />
        </SheetHeader>
        <SheetContent className="flex flex-col h-full bg-card">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-background">
        <div className="lg:hidden flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="font-bold text-primary">FlowMind</h1>
        </div>
        <Outlet />
      </main>
    </div>
  )
}
