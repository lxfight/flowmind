import { useParams } from 'react-router-dom'
import { ActivityFeed } from '../components/project/ActivityFeed'
import { Activity } from 'lucide-react'

export default function ActivityPage() {
  const { projectId } = useParams()
  if (!projectId) return null

  return (
    <div className="mx-auto h-full w-full max-w-[2000px] overflow-y-auto pb-4">
      <header className="mb-6 flex items-center gap-3 px-1">
        <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
          <Activity className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-foreground">项目动态</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">项目事件按时间连续展开</p>
        </div>
      </header>
      <ActivityFeed projectId={parseInt(projectId)} />
    </div>
  )
}
