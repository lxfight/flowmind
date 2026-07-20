import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useLayoutStore } from '../../stores/layoutStore'
import { useThemeStore } from '../../stores/themeStore'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu'
import { cn } from '../../utils/cn'
import type { Project } from '../../stores/projectStore'
import {
  Menu,
  Search,
  Sun,
  Moon,
  User,
  Settings,
  LogOut,
  Bell,
} from 'lucide-react'

interface TopBarProps {
  currentProject: Project | null
  user: { display_name: string; username: string; avatar_url: string } | null
  onLogout: () => void
}

export function TopBar({ currentProject, user, onLogout }: TopBarProps) {
  const openMobileSidebar = useLayoutStore((s) => s.openMobileSidebar)
  const pageHeader = useLayoutStore((s) => s.pageHeader)
  const { theme, toggle } = useThemeStore()
  const navigate = useNavigate()
  const [searchFocused, setSearchFocused] = useState(false)

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
              <span className="text-sm font-medium text-foreground">{pageHeader?.title || 'FlowMind'}</span>
            )}
          </div>
        </div>

        {/* Center: global search placeholder */}
        <div
          className={cn(
            'hidden md:flex items-center gap-2 flex-1 max-w-md px-3 py-1.5 rounded-xl transition-all',
            searchFocused ? 'glass-strong' : 'bg-transparent'
          )}
        >
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="全局搜索..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-foreground"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </div>

        {/* Right: notifications, theme, user */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground"
            title="通知"
          >
            <Bell className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground"
            onClick={toggle}
            title={theme === 'light' ? '切换暗色模式' : '切换亮色模式'}
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
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              <Settings className="mr-2 h-4 w-4" /> 设置
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
