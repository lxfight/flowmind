import { useLayoutStore } from '../../stores/layoutStore'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { PageHeader } from './PageHeader'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from '../ui/Sheet'
import type { Project } from '../../stores/projectStore'
import type { ReactNode } from 'react'

interface AppShellProps {
  projects: Project[]
  currentProject: Project | null
  user: { id: number; username: string; email: string; display_name: string; avatar_url: string; is_superuser: boolean } | null
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onSelectProject: (project: Project) => void
  onLogout: () => void
  children: ReactNode
}

export function AppShell({
  projects,
  currentProject,
  user,
  theme,
  onToggleTheme,
  onSelectProject,
  onLogout,
  children,
}: AppShellProps) {
  const mobileOpen = useLayoutStore((s) => s.mobileSidebarOpen)
  const closeMobileSidebar = useLayoutStore((s) => s.closeMobileSidebar)
  const pageHeader = useLayoutStore((s) => s.pageHeader)

  const sidebar = (
    <Sidebar
      projects={projects}
      currentProject={currentProject}
      user={user}
      theme={theme}
      onToggleTheme={onToggleTheme}
      onSelectProject={onSelectProject}
      onLogout={onLogout}
      onCloseMobile={closeMobileSidebar}
    />
  )

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 flex-col gap-2 p-3">
        <div className="surface h-full overflow-hidden">{sidebar}</div>
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onClose={closeMobileSidebar} side="left" className="w-[280px] lg:hidden">
        <SheetHeader className="sr-only">
          <SheetTitle>导航菜单</SheetTitle>
          <SheetClose onClose={closeMobileSidebar} />
        </SheetHeader>
        <SheetContent className="flex flex-col h-full bg-card">{sidebar}</SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar
          currentProject={currentProject}
          user={user}
          onLogout={onLogout}
        />
        <main className="flex-1 overflow-auto p-4 lg:p-8">
          {pageHeader && <PageHeader {...pageHeader} />}
          {children}
        </main>
      </div>
    </div>
  )
}
