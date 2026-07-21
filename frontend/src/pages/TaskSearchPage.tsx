import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Loader2, Search, SearchX } from 'lucide-react'
import api from '../utils/api'
import { searchTasks, type TaskSearchItem } from '../api/tasks'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { Avatar } from '../components/ui/Avatar'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../utils/cn'

const PAGE_SIZE = 50

const priorityConfig = {
  0: { label: '无', variant: 'secondary' as const },
  1: { label: '低', variant: 'info' as const },
  2: { label: '中', variant: 'warning' as const },
  3: { label: '高', variant: 'danger' as const },
  4: { label: '紧急', variant: 'danger' as const },
}

interface ProjectOption {
  id: number
  name: string
  color: string
}

interface MemberOption {
  user_id: number
  display_name: string
  username: string
}

interface StatusOption {
  id: number
  name: string
}

export default function TaskSearchPage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [projectId, setProjectId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState('')
  const [statusId, setStatusId] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [members, setMembers] = useState<MemberOption[]>([])
  const [statuses, setStatuses] = useState<StatusOption[]>([])

  const [tasks, setTasks] = useState<TaskSearchItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Debounce keyword input
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  // Load accessible projects + aggregate members for filter dropdowns
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get('/projects')
        if (cancelled) return
        const list: ProjectOption[] = res.data.map((p: any) => ({
          id: p.id,
          name: p.name,
          color: p.color,
        }))
        setProjects(list)
        const memberMap = new Map<number, MemberOption>()
        await Promise.all(
          list.map(async (p) => {
            try {
              const mres = await api.get(`/projects/${p.id}/members`)
              for (const m of mres.data) {
                if (!memberMap.has(m.user_id)) {
                  memberMap.set(m.user_id, {
                    user_id: m.user_id,
                    display_name: m.display_name || m.username,
                    username: m.username,
                  })
                }
              }
            } catch {
              // ignore single-project member failures
            }
          })
        )
        if (!cancelled) setMembers([...memberMap.values()])
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Load status columns for the selected project
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting filters when the selected project changes
    setStatusId('')
    setStatuses([])
    if (!projectId) return
    let cancelled = false
    api
      .get(`/projects/${projectId}/statuses`)
      .then((res) => {
        if (!cancelled) {
          setStatuses(res.data.map((s: any) => ({ id: s.id, name: s.name })))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId])

  const runSearch = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true)
      else setLoading(true)
      try {
        const data = await searchTasks({
          q: debouncedQ || undefined,
          project_id: projectId ? Number(projectId) : undefined,
          assignee_id: assigneeId ? (assigneeId === 'me' ? 'me' : Number(assigneeId)) : undefined,
          priority: priority ? Number(priority) : undefined,
          status_id: statusId ? Number(statusId) : undefined,
          overdue: overdueOnly ? true : undefined,
          limit: PAGE_SIZE,
          offset,
        })
        setTasks((prev) => (append ? [...prev, ...data.tasks] : data.tasks))
        setTotal(data.total)
      } catch {
        // ignore
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [debouncedQ, projectId, assigneeId, priority, statusId, overdueOnly]
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: async search updates state after await
    runSearch(0, false)
  }, [runSearch])

  const hasMore = tasks.length < total
  const hasActiveFilter = useMemo(
    () => !!(debouncedQ || projectId || assigneeId || priority || statusId || overdueOnly),
    [debouncedQ, projectId, assigneeId, priority, statusId, overdueOnly]
  )

  const formatDue = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <PageHeader title="任务搜索" description="跨项目搜索你有权访问的任务" />

      {/* Search + filters */}
      <div className="surface p-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索任务标题或描述..."
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">全部项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">全部负责人</option>
            <option value="me">只看我的</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </Select>
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">全部优先级</option>
            {([4, 3, 2, 1, 0] as const).map((p) => (
              <option key={p} value={p}>
                {priorityConfig[p].label}
              </option>
            ))}
          </Select>
          <Select
            value={statusId}
            onChange={(e) => setStatusId(e.target.value)}
            disabled={!projectId || statuses.length === 0}
            title={projectId ? undefined : '选择项目后可按状态筛选'}
          >
            <option value="">{projectId ? '全部状态' : '状态（先选项目）'}</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          只看逾期未完成
        </label>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 搜索中...
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="没有找到匹配的任务"
          description={hasActiveFilter ? '试试调整关键词或筛选条件' : '你所在的项目还没有任务'}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">共 {total} 个任务</p>
          <div className="surface divide-y divide-border/50 overflow-hidden">
            {tasks.map((t) => {
              const prio = priorityConfig[t.priority as keyof typeof priorityConfig] || priorityConfig[0]
              const isOverdue = !!t.due_date && !t.is_completed && new Date(t.due_date) < new Date()
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => navigate(`/project/${t.project_id}/board`)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-medium',
                          t.is_completed
                            ? 'text-muted-foreground line-through'
                            : 'text-foreground'
                        )}
                      >
                        {t.title}
                      </span>
                      <Badge variant={prio.variant} className="h-5 shrink-0 px-1.5 text-[10px]">
                        {prio.label}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: t.project_color }}
                        />
                        {t.project_name}
                      </span>
                      <span className="text-border">·</span>
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: `${t.status_color}1a`, color: t.status_color }}
                      >
                        {t.status_name}
                      </span>
                      {t.due_date && (
                        <>
                          <span className="text-border">·</span>
                          <span
                            className={cn(
                              'flex items-center gap-1',
                              isOverdue ? 'font-medium text-red-500' : ''
                            )}
                          >
                            <CalendarClock className="h-3 w-3" />
                            {formatDue(t.due_date)}
                            {isOverdue && '（已逾期）'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {t.assignees.length > 0 ? (
                    <div className="flex -space-x-1.5 shrink-0">
                      {t.assignees.slice(0, 3).map((a) => (
                        <Avatar
                          key={a.id}
                          name={a.display_name || a.username}
                          src={a.avatar_url}
                          size="sm"
                          className="ring-1 ring-background"
                        />
                      ))}
                      {t.assignees.length > 3 && (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground ring-1 ring-background">
                          +{t.assignees.length - 3}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">未指派</span>
                  )}
                </button>
              )
            })}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => runSearch(tasks.length, true)}
                loading={loadingMore}
              >
                加载更多（{tasks.length}/{total}）
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
