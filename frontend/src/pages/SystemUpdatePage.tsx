import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Gauge,
  History,
  RefreshCw,
  RotateCcw,
  ServerCog,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  applyUpdate,
  checkForUpdates,
  fetchReleases,
  fetchUpdateHistory,
  fetchUpdateStatus,
  rollbackUpdate,
  type ReleaseInfo,
  type UpdateOverview,
  type UpdateRun,
} from '../api/systemUpdate'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { MarkdownContent } from '../components/ui/MarkdownContent'
import { errDetail } from '../utils/api'
import { cn } from '../utils/cn'

const ACTIVE_STATUSES = new Set([
  'queued',
  'preparing',
  'backing_up',
  'downloading',
  'deploying',
  'verifying',
  'rolling_back',
])

const STATUS_LABELS: Record<string, string> = {
  idle: '就绪',
  unavailable: '不可用',
  queued: '等待执行',
  preparing: '更新前检查',
  backing_up: '备份数据库',
  downloading: '拉取镜像',
  deploying: '部署服务',
  verifying: '健康检查',
  rolling_back: '正在回滚',
  succeeded: '更新成功',
  rolled_back: '已回滚',
  failed: '更新失败',
}

const DEPLOY_STEPS = [
  { status: 'preparing', label: '检查' },
  { status: 'backing_up', label: '备份' },
  { status: 'downloading', label: '下载' },
  { status: 'deploying', label: '部署' },
  { status: 'verifying', label: '验证' },
] as const

type TabId = 'overview' | 'releases' | 'history'

const TABS = [
  { id: 'overview' as const, label: '概览', icon: Gauge },
  { id: 'releases' as const, label: '更新日志', icon: BookOpenText },
  { id: 'history' as const, label: '更新历史', icon: History },
]

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN')
}

function requestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '')
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function statusBadgeVariant(status: string | undefined) {
  if (status === 'failed') return 'danger' as const
  if (status === 'succeeded') return 'success' as const
  if (status && ACTIVE_STATUSES.has(status)) return 'info' as const
  return 'secondary' as const
}

export default function SystemUpdatePage() {
  const [overview, setOverview] = useState<UpdateOverview | null>(null)
  const [releases, setReleases] = useState<ReleaseInfo[]>([])
  const [history, setHistory] = useState<UpdateRun[]>([])
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [releasesLoading, setReleasesLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [starting, setStarting] = useState(false)
  const [connectionLost, setConnectionLost] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)

  const active = Boolean(overview && ACTIVE_STATUSES.has(overview.updater.status))

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await fetchUpdateHistory())
    } catch {
      // History is secondary to the live update state.
    }
  }, [])

  const loadReleases = useCallback(async () => {
    try {
      const data = await fetchReleases()
      setReleases(data.items)
      setReleaseError(data.error)
      setExpandedTags((current) => {
        if (current.size > 0 || data.items.length === 0) return current
        return new Set([data.items[0].tag_name])
      })
    } catch (err) {
      setReleaseError(errDetail(err, '更新日志加载失败'))
    } finally {
      setReleasesLoading(false)
    }
  }, [])

  const loadStatus = useCallback(async (quiet = false) => {
    try {
      const data = await fetchUpdateStatus()
      setOverview(data)
      setConnectionLost(false)
      if (!ACTIVE_STATUSES.has(data.updater.status)) void loadHistory()
    } catch (err) {
      if (quiet) {
        setConnectionLost(true)
      } else {
        toast.error(errDetail(err, '更新状态加载失败'))
      }
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [loadHistory])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async API load updates state after await
    void loadStatus()
    void loadHistory()
    void loadReleases()
  }, [loadHistory, loadReleases, loadStatus])

  useEffect(() => {
    if (!active && !connectionLost) return
    const timer = window.setInterval(() => void loadStatus(true), 2000)
    return () => window.clearInterval(timer)
  }, [active, connectionLost, loadStatus])

  const handleCheck = async () => {
    setChecking(true)
    try {
      setOverview(await checkForUpdates())
      await loadReleases()
      toast.success('已检查最新版本')
    } catch (err) {
      toast.error(errDetail(err, '检查更新失败'))
    } finally {
      setChecking(false)
    }
  }

  const handleApply = async () => {
    const version = overview?.latest?.version
    if (!version || starting) return
    if (!confirm(`确定更新到 FlowMind ${version}？更新期间服务会短暂重启。`)) return
    setStarting(true)
    try {
      await applyUpdate(version, requestId())
      await loadStatus(true)
      toast.success('更新任务已启动')
    } catch (err) {
      toast.error(errDetail(err, '更新任务启动失败'))
    } finally {
      setStarting(false)
    }
  }

  const handleRollback = async () => {
    const version = overview?.updater.previous_version
    if (!version || starting) return
    if (!confirm(`确定回滚到 FlowMind ${version}？数据库不会自动降级。`)) return
    setStarting(true)
    try {
      await rollbackUpdate(version, requestId())
      await loadStatus(true)
      toast.success('回滚任务已启动')
    } catch (err) {
      toast.error(errDetail(err, '回滚任务启动失败'))
    } finally {
      setStarting(false)
    }
  }

  const updateBadge = useMemo(() => {
    if (!overview) return null
    if (overview.update_available) return <Badge variant="info">有新版本</Badge>
    if (overview.check_error) return <Badge variant="warning">检查失败</Badge>
    if (!overview.latest) return <Badge variant="secondary">暂无发布</Badge>
    return <Badge variant="success">已是最新</Badge>
  }, [overview])

  const deployStatus = overview?.updater.status === 'failed'
    ? overview.updater.step
    : overview?.updater.status
  const deployStepIndex = deployStatus === 'succeeded'
    ? DEPLOY_STEPS.length
    : DEPLOY_STEPS.findIndex((step) => step.status === deployStatus)

  const toggleRelease = (tagName: string) => {
    setExpandedTags((current) => {
      const next = new Set(current)
      if (next.has(tagName)) next.delete(tagName)
      else next.add(tagName)
      return next
    })
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">正在读取版本信息...</div>
  }

  return (
    <div className="mx-auto h-full w-full max-w-[1400px] overflow-y-auto pb-10">
      <PageHeader
        title="系统更新"
        description="FlowMind 版本、发布说明与部署状态"
        actions={
          <Button variant="outline" size="sm" onClick={handleCheck} loading={checking} disabled={active}>
            <RefreshCw className="h-4 w-4" />
            检查更新
          </Button>
        }
      />

      <div className="border-b border-border px-6" role="tablist" aria-label="系统更新视图">
        <div className="flex min-w-max gap-6">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex h-11 items-center gap-2 text-sm text-muted-foreground transition-colors',
                  'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-transparent',
                  activeTab === tab.id && 'font-medium text-foreground after:bg-primary',
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-6 pt-6">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <section className="border-y border-border py-5">
              <div className="grid gap-6 md:grid-cols-[1fr_1fr_auto] md:items-center">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">当前版本</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {overview?.current.version || import.meta.env.VITE_APP_VERSION}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {overview?.current.git_sha?.slice(0, 12) || 'development'} · {formatTime(overview?.current.build_time)}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-muted-foreground">最新正式版本</p>
                    {updateBadge}
                  </div>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {overview?.latest?.version || '暂无 Release'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    发布于 {formatTime(overview?.latest?.published_at)} · 检查于 {formatTime(overview?.checked_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Button
                    onClick={handleApply}
                    loading={starting}
                    disabled={!overview?.update_available || !overview.updater.available || active}
                  >
                    <ServerCog className="h-4 w-4" />
                    更新到 {overview?.latest?.version || '新版本'}
                  </Button>
                  {overview?.updater.rollback_available && overview.updater.previous_version && (
                    <Button variant="outline" onClick={handleRollback} disabled={active || starting}>
                      <RotateCcw className="h-4 w-4" />
                      回滚
                    </Button>
                  )}
                </div>
              </div>
              {overview?.check_error && (
                <p className="mt-4 flex items-center gap-2 text-xs text-warning">
                  <AlertTriangle className="h-4 w-4" />
                  {overview.check_error}
                </p>
              )}
            </section>

            <section>
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">部署状态</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{overview?.updater.message}</p>
                </div>
                <Badge variant={statusBadgeVariant(overview?.updater.status)}>
                  {STATUS_LABELS[overview?.updater.status || 'unavailable'] || overview?.updater.status}
                </Badge>
              </div>

              <div className="overflow-x-auto pb-2">
                <div className="grid min-w-[560px] grid-cols-5">
                  {DEPLOY_STEPS.map((step, index) => {
                    const completed = deployStepIndex > index
                    const current = deployStepIndex === index
                    return (
                      <div key={step.status} className="relative text-center">
                        {index > 0 && (
                          <div className={cn(
                            'absolute right-1/2 top-2 h-px w-full bg-border',
                            completed && 'bg-primary',
                          )} />
                        )}
                        <span className={cn(
                          'relative mx-auto block h-4 w-4 rounded-full border-2 border-border bg-background',
                          completed && 'border-primary bg-primary',
                          current && 'border-primary bg-background ring-4 ring-primary/15',
                          overview?.updater.status === 'failed' && current && 'border-danger ring-danger/15',
                        )} />
                        <span className={cn(
                          'mt-2 block text-xs text-muted-foreground',
                          (completed || current) && 'font-medium text-foreground',
                        )}>
                          {step.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {connectionLost && (
                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  服务正在重启，等待重新连接
                </div>
              )}
              {!overview?.updater.available && (
                <div className="mt-4 border-l-2 border-warning pl-3 text-sm text-muted-foreground">
                  updater 不可用。可在服务器执行 <code className="rounded bg-muted px-1 py-0.5">scripts/update.sh &lt;version&gt;</code>。
                </div>
              )}
              {overview?.updater.error && (
                <div className="mt-4 border-l-2 border-danger pl-3 text-sm text-danger">
                  {overview.updater.error}
                </div>
              )}
              {overview?.updater.logs && overview.updater.logs.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">执行日志</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground scrollbar-thin">
                    {overview.updater.logs.join('\n')}
                  </pre>
                </details>
              )}
            </section>
          </div>
        )}

        {activeTab === 'releases' && (
          <section aria-label="更新日志">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">正式版本</h2>
                <p className="mt-1 text-xs text-muted-foreground">由发布工作流根据提交记录自动生成</p>
              </div>
              <span className="text-xs text-muted-foreground">共 {releases.length} 个版本</span>
            </div>

            {releaseError && (
              <div className="mb-5 border-l-2 border-warning pl-3 text-sm text-muted-foreground">
                {releaseError}，当前展示缓存内容。
              </div>
            )}

            {releasesLoading ? (
              <p className="py-10 text-sm text-muted-foreground">正在加载更新日志...</p>
            ) : releases.length === 0 ? (
              <p className="py-10 text-sm text-muted-foreground">暂无正式版本日志</p>
            ) : (
              <div className="divide-y divide-border border-y border-border">
                {releases.map((release) => {
                  const expanded = expandedTags.has(release.tag_name)
                  const isCurrent = release.version === overview?.current.version
                  const isAvailable = Boolean(
                    overview
                    && release.version === overview.latest?.version
                    && overview.update_available,
                  )
                  return (
                    <article key={release.tag_name}>
                      <div className="flex items-center gap-3 py-4">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => toggleRelease(release.tag_name)}
                          className="flex min-w-0 flex-1 items-center gap-4 text-left"
                        >
                          <ChevronDown className={cn(
                            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                            expanded && 'rotate-180',
                          )} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">{release.name}</span>
                              {isAvailable && <Badge variant="info">可更新</Badge>}
                              {isCurrent && <Badge variant="success">当前版本</Badge>}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {release.tag_name} · {formatTime(release.published_at)}
                            </span>
                          </span>
                        </button>
                        {release.html_url && (
                          <a
                            href={release.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="hidden items-center gap-1 text-xs text-primary hover:underline sm:inline-flex"
                          >
                            GitHub <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      {expanded && (
                        <div className="pb-6 pl-8 pr-1">
                          {release.body ? (
                            <MarkdownContent content={release.body} />
                          ) : (
                            <p className="text-sm text-muted-foreground">本版本暂无详细发布说明。</p>
                          )}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === 'history' && (
          <section aria-label="更新历史">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground">部署记录</h2>
              <p className="mt-1 text-xs text-muted-foreground">最近 30 次更新与回滚操作</p>
            </div>
            {history.length === 0 ? (
              <p className="py-10 text-sm text-muted-foreground">暂无更新记录</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">时间</th>
                      <th className="py-2 pr-4 font-medium">版本</th>
                      <th className="py-2 pr-4 font-medium">状态</th>
                      <th className="py-2 pr-4 font-medium">操作者</th>
                      <th className="py-2 font-medium">结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((run) => (
                      <tr key={run.id} className="border-b border-border/60">
                        <td className="py-3 pr-4 text-xs text-muted-foreground">{formatTime(run.created_at)}</td>
                        <td className="py-3 pr-4 font-medium">{run.previous_version} → {run.target_version}</td>
                        <td className="py-3 pr-4">
                          <span className="inline-flex items-center gap-1.5">
                            {run.status === 'succeeded' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                            ) : run.status === 'failed' ? (
                              <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                            ) : null}
                            {STATUS_LABELS[run.status] || run.status}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{run.actor_name || `#${run.actor_id}`}</td>
                        <td className="max-w-[320px] truncate py-3 text-muted-foreground" title={run.error || run.message}>
                          {run.error || run.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
