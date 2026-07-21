import { useParams } from 'react-router-dom'
import { ActivityFeed } from '../components/project/ActivityFeed'

export default function ActivityPage() {
  const { projectId } = useParams()
  if (!projectId) return null

  return (
    <div className="mx-auto h-full w-full max-w-[1200px] overflow-y-auto">
      <div>
        <h3 className="section-title mb-4">项目动态</h3>
        <ActivityFeed projectId={parseInt(projectId)} />
      </div>
    </div>
  )
}
