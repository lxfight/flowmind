import { Link } from 'react-router-dom'
import { NavItem } from './NavItem'
import { Avatar } from '../ui/Avatar'
import { cn } from '../../utils/cn'
import {
  LayoutGrid,
  FolderKanban,
  Shield,
  LogOut,
} from 'lucide-react'

interface SidebarProps {
  user: { id: number; username: string; email: string; display_name: string; avatar_url: string; is_superuser: boolean } | null
  onLogout: () => void
  onCloseMobile?: () => void
}

export function Sidebar({
  user,
  onLogout,
  onCloseMobile,
}: SidebarProps) {
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
        <nav className="space-y-1">
          <NavItem to="/" label="我的项目" icon={LayoutGrid} onClick={onCloseMobile} />
          {user?.is_superuser && (
            <NavItem to="/admin/users" label="用户管理" icon={Shield} onClick={onCloseMobile} />
          )}
        </nav>
      </div>

      {/* Middle spacer reserved for future features */}
      <div className="flex-1 min-h-0" aria-hidden="true" />

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
