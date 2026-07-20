import { Link, useNavigate } from 'react-router-dom'
import { NavItem } from './NavItem'
import { Avatar } from '../ui/Avatar'
import { cn } from '../../utils/cn'
import type { Project } from '../../stores/projectStore'
import {
  LayoutGrid,
  FolderKanban,
  Shield,
  LogOut,
} from 'lucide-react'

interface SidebarProps {
  projects: Project[]
  currentProject: Project | null
  user: { id: number; username: string; email: string; display_name: string; avatar_url: string; is_superuser: boolean } | null
  onSelectProject: (project: Project) => void
  onLogout: () => void
  onCloseMobile?: () => void
}

export function Sidebar({
  projects,
  currentProject,
  user,
  onSelectProject,
  onLogout,
  onCloseMobile,
}: SidebarProps) {
  const navigate = useNavigate()

  const handleProjectClick = (project: Project) => {
    onSelectProject(project)
    onCloseMobile?.()
  }

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-3 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <FolderKanban className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">FlowMind</h1>
          <p className="text-[10px] text-muted-foreground">智能任务管理</p>
        </div>
      </div>

      {/* Main nav */}
      <div className="px-3 pb-2">
        <NavItem to="/" label="我的项目" icon={LayoutGrid} onClick={onCloseMobile} />
      </div>

      {/* Projects */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">项目</span>
        </div>
        <nav className="space-y-1">
          {projects.map((project) => (
            <NavItem
              key={project.id}
              to={`/project/${project.id}/board`}
              label={project.name}
              startDecorator={
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
              }
              active={currentProject?.id === project.id}
              onClick={() => handleProjectClick(project)}
              className="pl-2"
            />
          ))}
        </nav>
      </div>

      {/* Admin */}
      {user?.is_superuser && (
        <div className="px-3 py-2">
          <NavItem to="/admin/users" label="用户管理" icon={Shield} onClick={onCloseMobile} />
        </div>
      )}

      {/* User card */}
      <div className="mx-3 mb-3 p-3 surface">
        <Link
          to="/profile"
          className="flex items-center gap-3 mb-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onCloseMobile?.()}
        >
          <Avatar name={user?.display_name || user?.username || 'User'} src={user?.avatar_url} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate text-foreground">{user?.display_name || user?.username}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email || user?.username}</p>
          </div>
        </Link>
        <button
          onClick={() => {
            onCloseMobile?.()
            onLogout()
          }}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          )}
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </button>
      </div>
    </div>
  )
}
