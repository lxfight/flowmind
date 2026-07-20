import { useParams } from 'react-router-dom'
import { ActivityFeed } from '../components/project/ActivityFeed'

export default function ActivityPage() {
  const { projectId } = useParams()
  if (!projectId) return null

  return (
    <div className="max-w-2xl mx-auto h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl">
        <h3 className="section-title mb-4">项目动态</h3>
        <ActivityFeed projectId={parseInt(projectId)} />
      </div>
    </div>
  )
}
