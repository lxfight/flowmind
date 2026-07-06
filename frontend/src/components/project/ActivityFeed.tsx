import { useState, useEffect } from 'react'
import { Plus, Edit3, Trash2, ArrowRight, FileText, Loader2 } from 'lucide-react'
import api from '../../utils/api'

interface Activity {
  id: number
  action: string
  target_type: string
  summary: string
  user_name: string
  created_at: string
}

interface Props {
  projectId: number
}

const actionIcons: Record<string, React.ComponentType<{ size?: number }>> = {
  create: Plus,
  update: Edit3,
  delete: Trash2,
  move: ArrowRight,
}

const actionColors: Record<string, string> = {
  create: 'text-green-600 bg-green-100 dark:bg-green-900/30',
  update: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30',
  delete: 'text-red-600 bg-red-100 dark:bg-red-900/30',
  move: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30',
}

export function ActivityFeed({ projectId }: Props) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [showMore, setShowMore] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get(`/projects/${projectId}/activities`, { params: { limit: showMore ? 50 : 15 } })
      .then((res) => setActivities(res.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, showMore])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText size={36} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500">暂无活动记录</p>
      </div>
    )
  }

  const getRelativeTime = (dateStr: string) => {
    const ms = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins} 分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} 小时前`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days} 天前`
    return new Date(dateStr).toLocaleDateString('zh-CN')
  }

  return (
    <div className="space-y-1">
      <div className="relative pl-6">
        {/* Timeline line */}
        <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-gray-200 dark:bg-gray-700" />

        {activities.map((a) => {
          const Icon = actionIcons[a.action] || FileText
          const colorClass = actionColors[a.action] || 'text-gray-600 bg-gray-100'

          return (
            <div key={a.id} className="relative pb-3 last:pb-0">
              {/* Dot */}
              <div className={`absolute left-[-13px] top-1.5 w-[7px] h-[7px] rounded-full border-2 border-white dark:border-gray-800 bg-gray-400`} />

              <div className="ml-2">
                <p className="text-sm text-gray-700 dark:text-gray-300">{a.summary}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {a.user_name} · {getRelativeTime(a.created_at)}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {!showMore && activities.length >= 15 && (
        <button
          className="text-xs text-primary-600 hover:underline w-full text-center py-2"
          onClick={() => setShowMore(true)}
        >
          加载更多
        </button>
      )}
    </div>
  )
}
