import { Link, useLocation } from 'react-router-dom'
import { cn } from '../../utils/cn'
import type { Project } from '../../stores/projectStore'
import {
  KanbanSquare,
  BookOpen,
  Activity,
  Users,
  FileText,
} from 'lucide-react'

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

  return (
    <div className="surface p-5 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <span
          className="mt-1.5 h-3 w-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: project.color }}
        />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{project.name}</h2>
          {project.description && (
            <p className="mt-0.5 text-sm text-muted-foreground truncate">{project.description}</p>
          )}
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
              to={fullPath}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl whitespace-nowrap transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
