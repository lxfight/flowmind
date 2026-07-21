import { useState, useEffect } from 'react'
import { Plus, Edit3, Trash2, ArrowRight, FileText, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import api from '../../utils/api'
import { Button } from '../ui/Button'
import { Card, CardContent } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { cn } from '../../utils/cn'

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

const actionIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  create: Plus,
  update: Edit3,
  delete: Trash2,
  move: ArrowRight,
}

const actionColors: Record<string, string> = {
  create: 'bg-success/15 text-success',
  update: 'bg-info/15 text-info',
  delete: 'bg-danger/15 text-danger',
  move: 'bg-primary/15 text-primary',
}

export function ActivityFeed({ projectId }: Props) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.get(`/projects/${projectId}/activities`, { params: { page: 1, page_size: showMore ? 50 : 15 } })
      .then((res) => {
        setActivities(res.data.items)
        setError(null)
      })
      .catch(() => {
        setError('加载动态失败')
      })
      .finally(() => setLoading(false))
  }, [projectId, showMore])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-danger mb-3" />
          <p className="text-sm text-foreground mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setShowMore((v) => !v)} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            重试
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (activities.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="暂无活动记录"
        description="项目中的任务操作将显示在这里"
      />
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
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="relative pl-8 pr-4 py-4">
          <div className="absolute left-[21px] top-3 bottom-3 w-px bg-border" />

          {activities.map((a) => {
            const Icon = actionIcons[a.action] || FileText
            const colorClass = actionColors[a.action] || 'bg-muted text-muted-foreground'

            return (
              <div key={a.id} className="relative pb-4 last:pb-0">
                <div className="absolute left-[-21px] top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-card">
                  <div className={cn('h-2.5 w-2.5 rounded-full', colorClass.split(' ')[1]?.replace('text-', 'bg-') || 'bg-muted-foreground')} />
                </div>

                <div className="flex items-start gap-3">
                  <div className={cn('rounded-lg p-1.5', colorClass)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{a.summary}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.user_name} · {getRelativeTime(a.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {!showMore && activities.length >= 15 && (
          <div className="border-t border-border p-2 text-center">
            <Button variant="ghost" size="sm" onClick={() => setShowMore(true)}>
              加载更多
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
