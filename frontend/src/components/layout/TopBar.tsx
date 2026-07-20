import { Link, useNavigate } from 'react-router-dom'
import { useLayoutStore } from '../../stores/layoutStore'
import { useThemeStore } from '../../stores/themeStore'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu'
import type { Project } from '../../stores/projectStore'
import {
  Menu,
  Sun,
  Moon,
  User,
  LogOut,
} from 'lucide-react'

interface TopBarProps {
  currentProject: Project | null
  user: { display_name: string; username: string; avatar_url: string } | null
  onLogout: () => void
}

export function TopBar({ currentProject, user, onLogout }: TopBarProps) {
  const openMobileSidebar = useLayoutStore((s) => s.openMobileSidebar)
  const { theme, toggle } = useThemeStore()
  const navigate = useNavigate()

  return (
    <header className="glass sticky top-0 z-20 h-16 px-4 lg:px-8">
      <div className="flex h-full items-center justify-between gap-4">
        {/* Left: mobile menu + breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-9 w-9"
            onClick={openMobileSidebar}
            aria-label="打开导航"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="hidden sm:flex items-center gap-2 min-w-0">
            {currentProject ? (
              <>
                <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  项目
                </Link>
                <span className="text-muted-foreground">/</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: currentProject.color }}
                  />
                  <span className="text-sm font-medium truncate text-foreground">{currentProject.name}</span>
                </div>
              </>
            ) : (
              <span className="text-sm font-medium text-foreground">FlowMind</span>
            )}
          </div>
        </div>

        {/* Right: theme, user */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground"
            onClick={toggle}
            aria-label={theme === 'light' ? '切换暗色模式' : '切换亮色模式'}
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>

          <DropdownMenu
            align="end"
            trigger={
              <button className="flex items-center gap-2 rounded-full p-1 pr-2.5 transition-colors hover:bg-accent">
                <Avatar
                  name={user?.display_name || user?.username || 'User'}
                  src={user?.avatar_url}
                  size="sm"
                />
                <span className="hidden sm:inline text-sm font-medium text-foreground">{user?.display_name || user?.username}</span>
              </button>
            }
          >
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              <User className="mr-2 h-4 w-4" /> 个人资料
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" /> 退出登录
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
