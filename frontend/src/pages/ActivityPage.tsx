import { useParams } from 'react-router-dom'
import { ActivityFeed } from '../components/project/ActivityFeed'

export default function ActivityPage() {
  const { projectId } = useParams()
  if (!projectId) return null

  return (
    <div className="mx-auto h-full w-full max-w-[2000px] overflow-y-auto pb-4">
      <h3 className="section-title mb-4">项目动态</h3>
      <ActivityFeed projectId={parseInt(projectId)} />
    </div>
  )
}
