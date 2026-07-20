import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../utils/cn'
import { useProjectStore } from '../../stores/projectStore'
import { useAuthStore } from '../../stores/authStore'
import type { Project } from '../../stores/projectStore'
import {
  KanbanSquare,
  BookOpen,
  Activity,
  Users,
  FileText,
  Settings,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EditProjectDialog } from '../project/EditProjectDialog'

interface ProjectHeaderProps {
  project: Project
}

const tabs = [
  { path: 'board', label: '看板', icon: KanbanSquare },
  { path: 'knowledge', label: '知识库', icon: BookOpen },
  { path: 'activities', label: '动态', icon: Activity },
  { path: 'members', label: '成员', icon: Users },
  { path: 'report', label: '报告', icon: FileText },
]

export function ProjectHeader({ project }: ProjectHeaderProps) {
  const location = useLocation()
  const { setCurrentProject } = useProjectStore()
  const user = useAuthStore((s) => s.user)
  const [showEdit, setShowEdit] = useState(false)
  const activeRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [location.pathname])

  const canEdit = user?.is_superuser || project.current_user_role === 'owner'

  return (
    <div className="surface p-5 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <span
          className="mt-1.5 h-3 w-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: project.color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{project.name}</h2>
              {project.description && (
                <p className="mt-0.5 text-sm text-muted-foreground truncate">{project.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {project.is_archived && (
                <Badge variant="secondary">已归档</Badge>
              )}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShowEdit(true)}
                  aria-label="编辑项目"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
        {tabs.map((tab) => {
          const fullPath = `/project/${project.id}/${tab.path}`
          const active = location.pathname.startsWith(fullPath)
          const Icon = tab.icon
          return (
            <Link
              key={tab.path}
              ref={active ? activeRef : undefined}
              to={fullPath}
              style={active ? { color: 'var(--project-accent, hsl(var(--primary)))' } : undefined}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors',
                active
                  ? 'text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {active && (
                <span
                  className="absolute inset-0 rounded-lg bg-primary/10"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--project-accent, hsl(var(--primary))) 10%, transparent)' }}
                  aria-hidden="true"
                />
              )}
              <Icon className="relative z-10 h-4 w-4" />
              <span className="relative z-10">{tab.label}</span>
            </Link>
          )
        })}
      </nav>

      {showEdit && (
        <EditProjectDialog
          project={project}
          onClose={() => setShowEdit(false)}
          onUpdated={(updated) => setCurrentProject(updated)}
        />
      )}
    </div>
  )
}
