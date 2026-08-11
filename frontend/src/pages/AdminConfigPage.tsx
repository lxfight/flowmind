import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import {
  deleteConfig,
  errDetail,
  fetchConfigs,
  updateConfig,
  type ConfigItem,
} from '../api/adminConfig'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { confirmAction } from '../components/ui/confirmAction'
import { cn } from '../utils/cn'

const GROUPS: { title: string; keys: string[] }[] = [
  {
    title: 'LLM 对话',
    keys: ['llm_api_key', 'llm_base_url', 'llm_model', 'llm_timeout'],
  },
  {
    title: 'Embedding',
    keys: [
      'embedding_api_key',
      'embedding_base_url',
      'llm_embedding_model',
      'llm_embedding_dim',
      'embedding_timeout',
      'embedding_max_retries',
      'embedding_retry_base_delay',
      'embedding_concurrency',
      'embedding_batch_size',
    ],
  },
  {
    title: 'RAG 检索',
    keys: ['chunk_size', 'chunk_overlap', 'top_k_retrieval', 'similarity_threshold'],
  },
  {
    title: '知识库',
    keys: ['knowledge_max_bytes'],
  },
  {
    title: '报告生成',
    keys: ['llm_report_timeout', 'llm_report_max_retries', 'llm_report_retry_base_delay'],
  },
]

const RANGES: Record<string, { min?: number; max?: number }> = {
  llm_timeout: { min: 5, max: 600 },
  llm_embedding_dim: { min: 64, max: 8192 },
  embedding_timeout: { min: 5, max: 180 },
  embedding_max_retries: { min: 0, max: 10 },
  embedding_retry_base_delay: { min: 0.5, max: 60 },
  embedding_concurrency: { min: 1, max: 10 },
  embedding_batch_size: { min: 1, max: 64 },
  chunk_size: { min: 64, max: 8192 },
  chunk_overlap: { min: 0, max: 2048 },
  top_k_retrieval: { min: 1, max: 50 },
  similarity_threshold: { min: 0, max: 1 },
  knowledge_max_bytes: { min: 1024, max: 512 * 1024 * 1024 },
  llm_report_timeout: { min: 30, max: 300 },
  llm_report_max_retries: { min: 0, max: 5 },
  llm_report_retry_base_delay: { min: 0.1, max: 10 },
}

function rangeHint(key: string): string | null {
  const r = RANGES[key]
  if (!r) return null
  if (r.min !== undefined && r.max !== undefined) return `取值范围：${r.min} ~ ${r.max}`
  if (r.min !== undefined) return `取值范围：≥ ${r.min}`
  return null
}

/** 前端范围/类型校验，返回错误信息或 null */
function validateDraft(item: ConfigItem, draft: string): string | null {
  if (item.kind === 'str') return null
  if (draft.trim() === '') return '请输入数值'
  const num = item.kind === 'int' ? Number(draft) : parseFloat(draft)
  if (Number.isNaN(num)) return '请输入合法数字'
  if (item.kind === 'int' && !Number.isInteger(num)) return '请输入整数'
  const r = RANGES[item.key]
  if (r?.min !== undefined && num < r.min) return `不能小于 ${r.min}`
  if (r?.max !== undefined && num > r.max) return `不能大于 ${r.max}`
  return null
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function displayValue(item: ConfigItem): string {
  if (item.secret) return item.is_set ? '******' : ''
  const v = String(item.value ?? '')
  if (item.key === 'knowledge_max_bytes' && typeof item.value === 'number') {
    return `${v}（${formatBytes(item.value)}）`
  }
  return v
}

function formatTime(iso: string | null): string | null {
  if (!iso) return null
  try {
    return format(new Date(iso), 'yyyy-MM-dd HH:mm')
  } catch {
    return null
  }
}

function NoPermission() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <ShieldAlert className="h-10 w-10 text-warning" />
          <h2 className="text-lg font-semibold">无权限访问</h2>
          <p className="text-sm text-muted-foreground">
            系统配置仅超级管理员可访问。如需调整，请联系管理员。
          </p>
          <Link to="/">
            <Button variant="outline" size="sm">返回首页</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

function ConfigRow({
  item,
  fallbackLabel,
  onChanged,
}: {
  item: ConfigItem
  fallbackLabel: string | null
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const updatedAt = formatTime(item.updated_at)
  const hint = rangeHint(item.key)
  const draftError = editing ? validateDraft(item, draft) : null
  const canSave = !saving && !draftError && !(item.secret && draft.trim() === '')
  const showFallback =
    !!item.fallback_key && !item.is_set && item.effective_source === item.fallback_key

  const startEdit = () => {
    setDraft(item.secret ? '' : String(item.value ?? ''))
    setEditing(true)
  }

  const handleSave = async () => {
    const err = validateDraft(item, draft)
    if (err) {
      toast.error(err)
      return
    }
    let value: string | number = draft
    if (item.kind === 'int') value = parseInt(draft, 10)
    else if (item.kind === 'float') value = parseFloat(draft)
    setSaving(true)
    try {
      await updateConfig(item.key, value)
      toast.success(`「${item.label}」已生效`)
      setEditing(false)
      onChanged()
    } catch (e) {
      toast.error(errDetail(e, '保存失败'), { duration: 8000 })
    }
    setSaving(false)
  }

  const handleReset = async () => {
    if (!(await confirmAction({
      title: '恢复默认配置',
      description: `「${item.label}」的数据库覆盖值将被清除。`,
      confirmLabel: '恢复默认',
      tone: 'warning',
      icon: 'reset',
    }))) return
    setResetting(true)
    try {
      await deleteConfig(item.key)
      toast.success(`「${item.label}」已恢复默认`)
      onChanged()
    } catch (e) {
      toast.error(errDetail(e, '恢复默认失败'))
    }
    setResetting(false)
  }

  return (
    <div className="group px-4 py-3 transition-colors hover:bg-muted/20">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium">{item.label}</p>
            <code className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.key}</code>
            {item.source === 'db' ? (
              <Badge variant="warning" className="h-4 px-1.5 text-[10px]">已覆盖</Badge>
            ) : (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">默认</Badge>
            )}
            {item.secret && (
              item.is_set
                ? <Badge variant="success" className="h-4 px-1.5 text-[10px]">已设置</Badge>
                : <Badge variant="danger" className="h-4 px-1.5 text-[10px]">未设置</Badge>
            )}
          </div>
          {!editing && (
            <p className="mt-1 break-all text-sm">
              {item.secret ? (
                <span className="font-mono text-muted-foreground">{item.is_set ? '******' : '—'}</span>
              ) : (
                <span className="font-mono">{displayValue(item) || '—'}</span>
              )}
            </p>
          )}
          {item.description && (
            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
          )}
          {showFallback && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              未设置，当前回退使用「{fallbackLabel ?? item.fallback_key}」
            </p>
          )}
          {item.key === 'llm_embedding_dim' && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                修改仅影响新写入的向量，已有向量不受影响。更换维度需同时更换 Embedding 模型并重建索引，否则检索结果会异常。
              </span>
            </div>
          )}
          {updatedAt && (
            <p className="mt-1 text-[11px] text-muted-foreground">最近修改：{updatedAt}</p>
          )}
        </div>

        {!editing ? (
          <div className="flex shrink-0 items-center gap-1.5 sm:ml-4">
            <Button variant="ghost" size="sm" onClick={startEdit} className="gap-1 px-2">
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </Button>
            {item.source === 'db' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                loading={resetting}
                className="gap-1 px-2 text-danger hover:text-danger hover:bg-danger/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                恢复默认
              </Button>
            )}
          </div>
        ) : (
          <div className="w-full shrink-0 sm:w-72">
            <Input
              type={item.secret ? 'password' : item.kind === 'str' ? 'text' : 'number'}
              step={item.kind === 'float' ? '0.01' : '1'}
              min={RANGES[item.key]?.min}
              max={RANGES[item.key]?.max}
              placeholder={item.secret ? (item.is_set ? '留空表示不修改' : '请输入密钥') : ''}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoComplete="off"
              aria-label={`编辑 ${item.label}`}
              className="h-8 text-sm"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className={cn('text-[11px]', draftError ? 'text-danger' : 'text-muted-foreground')}>
                {draftError ?? (item.secret ? '留空表示不修改' : hint ?? '')}
              </span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={handleSave} loading={saving} disabled={!canSave}>
                  保存
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  取消
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminConfigPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [items, setItems] = useState<ConfigItem[]>([])
  const [loading, setLoading] = useState(true)
  /** Groups the user has collapsed (by title). Defaults to expanded. */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = (title: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  const scrollToGroup = (title: string) => {
    document.getElementById(`config-group-${title}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchConfigs()
      setItems(data)
    } catch (err) {
      toast.error(errDetail(err, '加载配置失败'))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (currentUser && !currentUser.is_superuser) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: async loader updates state after await
    load()
  }, [currentUser, load])

  if (currentUser && !currentUser.is_superuser) return <NoPermission />

  if (loading && items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const byKey = new Map(items.map((i) => [i.key, i]))
  const visibleGroups = GROUPS.filter((group) =>
    group.keys.some((k) => byKey.has(k))
  )

  return (
    <div className="mx-auto h-full w-full max-w-[1600px] overflow-y-auto pb-8">
      <PageHeader
        title="系统配置"
        description="管理 LLM / Embedding / RAG 运行时参数，修改立即生效；可在 API 异常时快速调整并验证连通性"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      {/* Quick-jump navigation */}
      <nav aria-label="配置分组导航" className="mb-6 flex flex-wrap items-center gap-2">
        {visibleGroups.map((group) => (
          <button
            key={group.title}
            type="button"
            onClick={() => scrollToGroup(group.title)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
              'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary'
            )}
          >
            {group.title}
            <span className="tnum text-[10px] text-muted-foreground/70">
              {group.keys.filter((k) => byKey.has(k)).length}
            </span>
          </button>
        ))}
      </nav>

      {visibleGroups.map((group) => {
        const groupItems = group.keys
          .map((k) => byKey.get(k))
          .filter((i): i is ConfigItem => !!i)
        const collapsed = collapsedGroups.has(group.title)
        const hasOverrides = groupItems.some((i) => i.source === 'db')
        return (
          <div key={group.title} id={`config-group-${group.title}`} className="mb-4 scroll-mt-4">
            <button
              type="button"
              onClick={() => toggleGroup(group.title)}
              aria-expanded={!collapsed}
              className="flex w-full items-center gap-2 rounded-md px-1 py-2 text-left transition-colors hover:bg-muted/40"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
              <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
              <span className="tnum text-xs text-muted-foreground">{groupItems.length} 项</span>
              {hasOverrides && <Badge variant="warning" className="h-4 px-1.5 text-[10px]">含已覆盖项</Badge>}
            </button>
            {!collapsed && (
              <div className="divide-y divide-border border-y border-border">
                {groupItems.map((item) => (
                  <ConfigRow
                    key={item.key}
                    item={item}
                    fallbackLabel={item.fallback_key ? byKey.get(item.fallback_key)?.label ?? null : null}
                    onChanged={load}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
