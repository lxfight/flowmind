import { useLayoutStore } from '../../stores/layoutStore'
import { useResizableWidth } from '../../hooks/useResizableWidth'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetClose,
  SheetContent,
} from '../ui/Sheet'
import type { Project } from '../../stores/projectStore'
import type { ReactNode } from 'react'

interface AppShellProps {
  currentProject: Project | null
  user: { id: number; username: string; email: string; display_name: string; avatar_url: string; is_superuser: boolean } | null
  onLogout: () => void
  children: ReactNode
}

export function AppShell({
  currentProject,
  user,
  onLogout,
  children,
}: AppShellProps) {
  const mobileOpen = useLayoutStore((s) => s.mobileSidebarOpen)
  const closeMobileSidebar = useLayoutStore((s) => s.closeMobileSidebar)
  const { width: sidebarWidth, startResize: startSidebarResize } = useResizableWidth({
    storageKey: 'flowmind.sidebar.width',
    defaultWidth: 240,
    min: 200,
    max: 400,
  })

  const sidebar = (
    <Sidebar
      user={user}
      onLogout={onLogout}
      onCloseMobile={closeMobileSidebar}
    />
  )

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className="relative hidden lg:flex flex-col gap-2 p-3 pr-1.5 shrink-0"
        style={{ width: sidebarWidth }}
      >
        <div className="surface h-full overflow-hidden">{sidebar}</div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          title="拖拽调整侧栏宽度"
          onPointerDown={startSidebarResize}
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize rounded-full transition-colors hover:bg-primary/30 active:bg-primary/50"
          style={{ touchAction: 'none' }}
        />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onClose={closeMobileSidebar} side="left" className="w-[280px] lg:hidden" ariaLabel="导航菜单">
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
        <main className="flex-1 overflow-auto p-4 lg:p-8 2xl:p-10">
          {children}
        </main>
      </div>
    </div>
  )
}
