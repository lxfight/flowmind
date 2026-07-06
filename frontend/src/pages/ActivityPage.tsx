import { useParams } from 'react-router-dom'
import { ActivityFeed } from '../components/project/ActivityFeed'

export default function ActivityPage() {
  const { projectId } = useParams()
  if (!projectId) return null

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <h3 className="text-lg font-semibold dark:text-gray-100 mb-4">项目动态</h3>
        <ActivityFeed projectId={parseInt(projectId)} />
      </div>
    </div>
  )
}
