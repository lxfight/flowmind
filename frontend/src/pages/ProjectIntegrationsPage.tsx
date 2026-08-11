import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import {
  Clipboard,
  Clock3,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Trash2,
  Webhook,
} from 'lucide-react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  createIntegration,
  deleteIntegration,
  listEventCatalog,
  listExternalDeliveries,
  listIntegrations,
  retryExternalDelivery,
  rotateIntegrationSecret,
  testIntegration,
  updateIntegration,
} from '../api/integrations'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/Dialog'
import { EmptyState } from '../components/ui/EmptyState'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Switch } from '../components/ui/Switch'
import { confirmAction } from '../components/ui/confirmAction'
import { useProjectRole } from '../hooks/useProjectRole'
import { useAuthStore } from '../stores/authStore'
import type {
  EventDefinition,
  ExternalDelivery,
  ExternalDeliveryStatus,
  ExternalIntegration,
  ExternalIntegrationInput,
} from '../types'
import { errDetail } from '../utils/api'
import { cn } from '../utils/cn'

const DELIVERY_STATUS: Record<ExternalDeliveryStatus, {
  label: string
  variant: 'success' | 'danger' | 'warning' | 'secondary' | 'outline'
}> = {
  pending: { label: '等待投递', variant: 'secondary' },
  processing: { label: '投递中', variant: 'warning' },
  retrying: { label: '等待重试', variant: 'warning' },
  succeeded: { label: '已送达', variant: 'success' },
  failed: { label: '失败', variant: 'danger' },
  cancelled: { label: '已取消', variant: 'outline' },
}

function relativeTime(value: string | null) {
  if (!value) return '尚无记录'
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: zhCN })
}

function IntegrationDialog({
  open,
  integration,
  catalog,
  isSuperuser,
  saving,
  onClose,
  onSave,
}: {
  open: boolean
  integration: ExternalIntegration | null
  catalog: EventDefinition[]
  isSuperuser: boolean
  saving: boolean
  onClose: () => void
  onSave: (input: ExternalIntegrationInput) => void
}) {
  const [name, setName] = useState(integration?.name ?? '')
  const [url, setUrl] = useState(integration?.url ?? '')
  const [enabled, setEnabled] = useState(integration?.is_enabled ?? true)
  const [allowPrivate, setAllowPrivate] = useState(integration?.allow_private_network ?? false)
  const [events, setEvents] = useState<string[]>(
    integration?.event_types ?? catalog.filter((item) => item.default_enabled).map((item) => item.type),
  )
  const grouped = useMemo(() => {
    const result = new Map<string, EventDefinition[]>()
    catalog.forEach((item) => result.set(item.group, [...(result.get(item.group) ?? []), item]))
    return [...result.entries()]
  }, [catalog])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !url.trim() || events.length === 0) return
    onSave({
      name: name.trim(),
      url: url.trim(),
      event_types: events,
      is_enabled: enabled,
      allow_private_network: allowPrivate,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle showClose onClose={onClose}>{integration ? '编辑 Webhook' : '添加 Webhook'}</DialogTitle>
          <DialogDescription>选择需要推送的项目事件。接收方可使用签名密钥验证请求来源。</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-6 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              名称
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：发布通知" autoFocus />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Webhook 地址
              <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/webhooks/flowmind" type="url" />
            </label>
          </div>

          <section aria-labelledby="webhook-events-title">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 id="webhook-events-title" className="text-sm font-semibold">订阅事件</h3>
              <span className="text-xs text-muted-foreground">已选择 {events.length} 项</span>
            </div>
            <div className="divide-y divide-border rounded-md border border-border">
              {grouped.map(([group, items]) => (
                <div key={group} className="grid gap-2 p-3 sm:grid-cols-[6rem_1fr]">
                  <strong className="pt-1 text-xs text-muted-foreground">{group}</strong>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((item) => {
                      const checked = events.includes(item.type)
                      return (
                        <label key={item.type} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setEvents((current) => checked
                              ? current.filter((value) => value !== item.type)
                              : [...current, item.type])}
                            className="h-4 w-4 rounded border-input accent-primary"
                          />
                          <span>{item.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="space-y-3 border-t border-border pt-4">
            <label className="flex items-center justify-between gap-4">
              <span><strong className="block text-sm">启用投递</strong><small className="text-muted-foreground">关闭后保留配置和历史记录</small></span>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="启用投递" />
            </label>
            {isSuperuser && (
              <label className="flex items-center justify-between gap-4">
                <span><strong className="block text-sm">允许内网地址</strong><small className="text-muted-foreground">仅用于可信的自托管接收服务</small></span>
                <Switch checked={allowPrivate} onCheckedChange={setAllowPrivate} aria-label="允许内网地址" />
              </label>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="submit" loading={saving} disabled={!name.trim() || !url.trim() || events.length === 0}>
            {integration ? '保存变更' : '创建 Webhook'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

function SecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const copy = async () => {
    if (!secret) return
    await navigator.clipboard.writeText(secret)
    toast.success('签名密钥已复制')
  }
  return (
    <Dialog open={Boolean(secret)} onClose={onClose}>
      <DialogHeader>
        <DialogTitle showClose onClose={onClose}>保存签名密钥</DialogTitle>
        <DialogDescription>该密钥仅显示一次。接收服务使用它校验 X-FlowMind-Signature。</DialogDescription>
      </DialogHeader>
      <div className="px-6 py-5">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/45 p-3">
          <code className="min-w-0 flex-1 break-all text-xs">{secret}</code>
          <Button type="button" variant="ghost" size="icon" onClick={copy} title="复制密钥" aria-label="复制签名密钥">
            <Clipboard className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <DialogFooter><Button type="button" onClick={onClose}>我已保存</Button></DialogFooter>
    </Dialog>
  )
}

export default function ProjectIntegrationsPage() {
  const projectId = Number(useParams().projectId)
  const role = useProjectRole()
  const user = useAuthStore((state) => state.user)
  const canManage = role === 'owner' || role === 'admin'
  const [view, setView] = useState<'integrations' | 'deliveries'>('integrations')
  const [integrations, setIntegrations] = useState<ExternalIntegration[]>([])
  const [catalog, setCatalog] = useState<EventDefinition[]>([])
  const [deliveries, setDeliveries] = useState<ExternalDelivery[]>([])
  const [deliveryTotal, setDeliveryTotal] = useState(0)
  const [deliveryPage, setDeliveryPage] = useState(1)
  const [deliveryStatus, setDeliveryStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshingDeliveries, setRefreshingDeliveries] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ExternalIntegration | null>(null)
  const [saving, setSaving] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const loadDeliveries = useCallback(async (page = deliveryPage, status = deliveryStatus, quiet = false) => {
    if (!projectId || !canManage) return
    if (!quiet) setRefreshingDeliveries(true)
    try {
      const result = await listExternalDeliveries(projectId, { page, status })
      setDeliveries(result.items)
      setDeliveryTotal(result.total)
      setDeliveryPage(result.page)
    } catch (error) {
      toast.error(errDetail(error, '投递记录加载失败'))
    } finally {
      setRefreshingDeliveries(false)
    }
  }, [canManage, deliveryPage, deliveryStatus, projectId])

  const loadAll = useCallback(async () => {
    if (!projectId || !canManage) return
    setLoading(true)
    try {
      const [nextIntegrations, nextCatalog, nextDeliveries] = await Promise.all([
        listIntegrations(projectId),
        listEventCatalog(projectId),
        listExternalDeliveries(projectId),
      ])
      setIntegrations(nextIntegrations)
      setCatalog(nextCatalog)
      setDeliveries(nextDeliveries.items)
      setDeliveryTotal(nextDeliveries.total)
      // listExternalDeliveries defaults to page 1; keep the pager in sync.
      setDeliveryPage(nextDeliveries.page ?? 1)
    } catch (error) {
      toast.error(errDetail(error, '外部集成加载失败'))
    } finally {
      setLoading(false)
    }
  }, [canManage, projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount loader owns page state
    void loadAll()
  }, [loadAll])

  const save = async (input: ExternalIntegrationInput) => {
    setSaving(true)
    try {
      if (editing) {
        await updateIntegration(projectId, editing.id, input)
        toast.success('Webhook 已更新')
      } else {
        const created = await createIntegration(projectId, input)
        setSecret(created.signing_secret)
        toast.success('Webhook 已创建')
      }
      setDialogOpen(false)
      setEditing(null)
      await loadAll()
    } catch (error) {
      toast.error(errDetail(error, editing ? '更新 Webhook 失败' : '创建 Webhook 失败'))
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (integration: ExternalIntegration, enabled: boolean) => {
    setBusyId(integration.id)
    try {
      const saved = await updateIntegration(projectId, integration.id, { is_enabled: enabled })
      setIntegrations((current) => current.map((item) => item.id === saved.id ? saved : item))
      toast.success(enabled ? 'Webhook 已启用' : 'Webhook 已暂停')
    } catch (error) {
      toast.error(errDetail(error, '状态更新失败'))
    } finally {
      setBusyId(null)
    }
  }

  const sendTest = async (integration: ExternalIntegration) => {
    setBusyId(integration.id)
    try {
      await testIntegration(projectId, integration.id)
      toast.success('测试通知已加入投递队列')
      setView('deliveries')
      await loadDeliveries(1, '', true)
    } catch (error) {
      toast.error(errDetail(error, '测试通知发送失败'))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (integration: ExternalIntegration) => {
    if (!(await confirmAction({
      title: '删除外部集成',
      description: `将停用「${integration.name}」并取消尚未发送的通知，历史投递记录会保留。`,
      confirmLabel: '删除集成',
      tone: 'danger',
      icon: 'delete',
    }))) return
    try {
      await deleteIntegration(projectId, integration.id)
      toast.success('外部集成已删除')
      await loadAll()
    } catch (error) {
      toast.error(errDetail(error, '删除外部集成失败'))
    }
  }

  const rotate = async (integration: ExternalIntegration) => {
    if (!(await confirmAction({
      title: '重新生成签名密钥',
      description: '旧密钥会立即失效，接收服务必须同步更新。',
      confirmLabel: '重新生成',
      tone: 'danger',
      icon: 'warning',
    }))) return
    try {
      setSecret(await rotateIntegrationSecret(projectId, integration.id))
    } catch (error) {
      toast.error(errDetail(error, '生成密钥失败'))
    }
  }

  const retry = async (delivery: ExternalDelivery) => {
    try {
      await retryExternalDelivery(projectId, delivery.id)
      toast.success('已重新加入投递队列')
      await loadDeliveries(deliveryPage, deliveryStatus, true)
    } catch (error) {
      toast.error(errDetail(error, '重新投递失败'))
    }
  }

  if (!canManage) {
    return <EmptyState icon={ShieldAlert} title="无权管理外部集成" description="仅项目所有者和管理员可以查看或配置外部通知。" />
  }
  if (loading) {
    return <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  }

  const activeCount = integrations.filter((item) => item.is_enabled).length
  const failingCount = integrations.filter((item) => item.consecutive_failures > 0).length
  const pageCount = Math.max(1, Math.ceil(deliveryTotal / 30))

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-primary"><Webhook className="h-5 w-5" /></span>
          <div><h1 className="text-xl font-semibold">外部集成</h1><p className="mt-0.5 text-xs text-muted-foreground">可靠地将项目事件推送到外部系统</p></div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden gap-4 text-xs text-muted-foreground sm:flex">
            <span>已启用 <strong className="ml-1 text-foreground">{activeCount}</strong></span>
            <span>异常 <strong className={cn('ml-1', failingCount && 'text-danger')}>{failingCount}</strong></span>
          </div>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}><Plus className="h-4 w-4" />添加 Webhook</Button>
        </div>
      </header>

      <div className="mb-4 flex items-center gap-1 border-b border-border" role="tablist" aria-label="外部集成视图">
        {([['integrations', '集成配置'], ['deliveries', '投递记录']] as const).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={view === value} onClick={() => setView(value)} className={cn('relative h-10 px-3 text-sm font-medium text-muted-foreground', view === value && 'text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary')}>{label}</button>
        ))}
      </div>

      {view === 'integrations' ? (
        integrations.length === 0 ? (
          <EmptyState icon={Webhook} title="尚未配置外部通知" description="添加 Webhook 后，FlowMind 会将选定的项目事件可靠地推送出去。" action={<Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4" />添加 Webhook</Button>} />
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
            {integrations.map((integration) => (
              <section key={integration.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(16rem,1.4fr)_minmax(10rem,0.7fr)_auto] lg:items-center">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cn('mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-md', integration.is_enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}><Webhook className="h-4 w-4" /></span>
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold">{integration.name}</h2><Badge variant={integration.is_enabled ? 'success' : 'secondary'}>{integration.is_enabled ? '已启用' : '已暂停'}</Badge>{integration.allow_private_network && <Badge variant="warning">内网</Badge>}</div><p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={integration.url}>{integration.url}</p><p className="mt-1 text-xs text-muted-foreground">订阅 {integration.event_types.length} 类事件</p></div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs"><div><span className="text-muted-foreground">最近成功</span><strong className="mt-1 block font-medium">{relativeTime(integration.last_success_at)}</strong></div><div><span className="text-muted-foreground">连续失败</span><strong className={cn('mt-1 block font-medium', integration.consecutive_failures && 'text-danger')}>{integration.consecutive_failures} 次</strong></div></div>
                <div className="flex items-center justify-end gap-1">
                  <Switch checked={integration.is_enabled} onCheckedChange={(checked) => toggle(integration, checked)} disabled={busyId === integration.id} aria-label={`${integration.is_enabled ? '暂停' : '启用'} ${integration.name}`} />
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => sendTest(integration)} disabled={!integration.is_enabled || busyId === integration.id} title="发送测试" aria-label={`测试 ${integration.name}`}><Send className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => { setEditing(integration); setDialogOpen(true) }} title="编辑" aria-label={`编辑 ${integration.name}`}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => rotate(integration)} title="轮换密钥" aria-label={`轮换 ${integration.name} 的密钥`}><KeyRound className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-danger" onClick={() => remove(integration)} title="删除" aria-label={`删除 ${integration.name}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </section>
            ))}
          </div>
        )
      ) : (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Select value={deliveryStatus} onChange={(event) => { setDeliveryStatus(event.target.value); void loadDeliveries(1, event.target.value) }} className="h-8 w-36 text-xs" aria-label="筛选投递状态"><option value="">全部状态</option>{Object.entries(DELIVERY_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</Select>
            <Button variant="outline" size="sm" onClick={() => loadDeliveries()} loading={refreshingDeliveries}><RefreshCw className="h-3.5 w-3.5" />刷新</Button>
          </div>
          {deliveries.length === 0 ? <EmptyState icon={Clock3} title="还没有投递记录" description="发送测试通知或触发已订阅事件后，记录会出现在这里。" /> : (
            <div className="overflow-x-auto rounded-md border border-border bg-card"><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-b border-border bg-muted/35 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">事件</th><th className="px-4 py-3 font-medium">集成</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 font-medium">尝试</th><th className="px-4 py-3 font-medium">响应</th><th className="px-4 py-3 font-medium">时间</th><th className="w-14 px-4 py-3" /></tr></thead><tbody className="divide-y divide-border">{deliveries.map((delivery) => { const cfg = DELIVERY_STATUS[delivery.status]; return <tr key={delivery.id} className="hover:bg-muted/25"><td className="px-4 py-3"><strong className="block text-xs font-medium">{delivery.event_type}</strong><span className="text-xs text-muted-foreground">{delivery.resource_type}{delivery.resource_id ? ` #${delivery.resource_id}` : ''}</span></td><td className="px-4 py-3 text-xs">{delivery.integration_name}</td><td className="px-4 py-3"><Badge variant={cfg.variant}>{cfg.label}</Badge>{delivery.error_message && <p className="mt-1 max-w-56 truncate text-[11px] text-danger" title={delivery.error_message}>{delivery.error_message}</p>}</td><td className="px-4 py-3 text-xs tnum">{delivery.attempt_count}</td><td className="px-4 py-3 text-xs tnum">{delivery.response_status ?? '-'}</td><td className="px-4 py-3 text-xs text-muted-foreground">{relativeTime(delivery.created_at)}</td><td className="px-4 py-3">{(['failed', 'cancelled'] as ExternalDeliveryStatus[]).includes(delivery.status) && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => retry(delivery)} title="重新投递" aria-label="重新投递"><RotateCcw className="h-3.5 w-3.5" /></Button>}</td></tr> })}</tbody></table></div>
          )}
          {deliveryTotal > 30 && <div className="mt-3 flex items-center justify-end gap-3"><Button variant="outline" size="sm" disabled={deliveryPage <= 1} onClick={() => loadDeliveries(deliveryPage - 1)}>上一页</Button><span className="text-xs text-muted-foreground">{deliveryPage} / {pageCount}</span><Button variant="outline" size="sm" disabled={deliveryPage >= pageCount} onClick={() => loadDeliveries(deliveryPage + 1)}>下一页</Button></div>}
        </section>
      )}

      {dialogOpen && <IntegrationDialog key={editing?.id ?? 'new'} open integration={editing} catalog={catalog} isSuperuser={Boolean(user?.is_superuser)} saving={saving} onClose={() => { setDialogOpen(false); setEditing(null) }} onSave={save} />}
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  )
}
