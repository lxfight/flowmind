import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Plug,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import {
  deleteConfig,
  errDetail,
  fetchConfigs,
  testConnection,
  updateConfig,
  type ConfigItem,
  type ConfigTestProbe,
  type ConfigTestResult,
} from '../api/adminConfig'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { cn } from '../utils/cn'

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'LLM 对话', keys: ['llm_api_key', 'llm_base_url', 'llm_model'] },
  {
    title: 'Embedding',
    keys: ['embedding_api_key', 'embedding_base_url', 'llm_embedding_model', 'llm_embedding_dim'],
  },
  { title: 'RAG 检索', keys: ['chunk_size', 'chunk_overlap', 'top_k_retrieval', 'similarity_threshold'] },
  { title: '知识库', keys: ['knowledge_max_bytes'] },
]

const RANGES: Record<string, { min?: number; max?: number }> = {
  llm_embedding_dim: { min: 64, max: 8192 },
  chunk_size: { min: 64, max: 8192 },
  chunk_overlap: { min: 0, max: 2048 },
  top_k_retrieval: { min: 1, max: 50 },
  similarity_threshold: { min: 0, max: 1 },
  knowledge_max_bytes: { min: 1024, max: 512 * 1024 * 1024 },
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

function endpointText(baseUrl: string): string {
  return baseUrl || '（默认 OpenAI）'
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

function ProbeResult({ probe }: { probe: ConfigTestProbe | null }) {
  if (!probe) return null
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        probe.ok ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {probe.ok ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <XCircle className="h-4 w-4 text-danger" />
        )}
        <Badge variant={probe.ok ? 'success' : 'danger'}>{probe.ok ? '成功' : '失败'}</Badge>
        {probe.latency_ms !== null && (
          <span className="text-xs text-muted-foreground">{probe.latency_ms} ms</span>
        )}
      </div>
      <p className="mt-1.5 break-all text-[11px] text-muted-foreground">
        端点：{endpointText(probe.base_url)}{probe.model ? ` · 模型：${probe.model}` : ''}
      </p>
      {!probe.ok && probe.error && (
        <p className="mt-2 break-all rounded-md bg-danger/10 px-3 py-2 text-xs font-mono text-danger">
          {probe.error}
        </p>
      )}
    </div>
  )
}

interface SectionDraft {
  apiKey: string
  baseUrl: string
  model: string
}

function TestSection({
  title,
  summary,
  draft,
  onDraft,
  apiKeyPlaceholder,
  baseUrlPlaceholder,
  modelPlaceholder,
  testing,
  onTest,
  probe,
}: {
  title: string
  summary: string
  draft: SectionDraft
  onDraft: (d: SectionDraft) => void
  apiKeyPlaceholder: string
  baseUrlPlaceholder: string
  modelPlaceholder: string
  testing: boolean
  onTest: () => void
  probe: ConfigTestProbe | null
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="mt-1 break-all text-[11px] text-muted-foreground">{summary}</p>
      <div className="mt-3 space-y-2.5">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">API Key（留空用当前值）</label>
          <Input
            type="password"
            placeholder={apiKeyPlaceholder}
            value={draft.apiKey}
            onChange={(e) => onDraft({ ...draft, apiKey: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Base URL</label>
          <Input
            placeholder={baseUrlPlaceholder}
            value={draft.baseUrl}
            onChange={(e) => onDraft({ ...draft, baseUrl: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">模型</label>
          <Input
            placeholder={modelPlaceholder}
            value={draft.model}
            onChange={(e) => onDraft({ ...draft, model: e.target.value })}
          />
        </div>
      </div>
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={onTest} loading={testing} className="gap-1.5">
          <Plug className="h-3.5 w-3.5" />
          测试{title}
        </Button>
      </div>
      {probe && (
        <div className="mt-3">
          <ProbeResult probe={probe} />
        </div>
      )}
    </div>
  )
}

function ConnectivityCard({ items, onSaved }: { items: ConfigItem[]; onSaved: () => void }) {
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items])

  const [llm, setLlm] = useState<SectionDraft>({ apiKey: '', baseUrl: '', model: '' })
  const [emb, setEmb] = useState<SectionDraft>({ apiKey: '', baseUrl: '', model: '' })
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ConfigTestResult | null>(null)

  const hasDraft = !!(llm.apiKey || llm.baseUrl || llm.model || emb.apiKey || emb.baseUrl || emb.model)

  const handleTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      const overrides: Record<string, string> = {}
      if (llm.apiKey) overrides.llm_api_key = llm.apiKey
      if (llm.baseUrl) overrides.llm_base_url = llm.baseUrl
      if (llm.model) overrides.chat_model = llm.model
      if (emb.apiKey) overrides.embedding_api_key = emb.apiKey
      if (emb.baseUrl) overrides.embedding_base_url = emb.baseUrl
      if (emb.model) overrides.embedding_model = emb.model
      const res = await testConnection(overrides)
      setResult(res)
    } catch (err) {
      toast.error(errDetail(err, '连通性测试请求失败'))
    }
    setTesting(false)
  }

  const handleSaveDrafts = async () => {
    const targets: { key: string; label: string; value: string }[] = []
    if (llm.apiKey) targets.push({ key: 'llm_api_key', label: 'LLM API Key', value: llm.apiKey })
    if (llm.baseUrl) targets.push({ key: 'llm_base_url', label: 'LLM Base URL', value: llm.baseUrl })
    if (llm.model) targets.push({ key: 'llm_model', label: 'Chat 模型', value: llm.model })
    if (emb.apiKey) targets.push({ key: 'embedding_api_key', label: 'Embedding API Key', value: emb.apiKey })
    if (emb.baseUrl) targets.push({ key: 'embedding_base_url', label: 'Embedding Base URL', value: emb.baseUrl })
    if (emb.model) targets.push({ key: 'llm_embedding_model', label: 'Embedding 模型', value: emb.model })
    if (targets.length === 0) return
    if (!confirm(`将以下 ${targets.length} 项测试参数保存为配置并立即生效？\n${targets.map((t) => `- ${t.label}`).join('\n')}`)) return
    setSaving(true)
    const failed: string[] = []
    for (const t of targets) {
      try {
        await updateConfig(t.key, t.value)
      } catch (err) {
        failed.push(`${t.label}: ${errDetail(err, '保存失败')}`)
      }
    }
    setSaving(false)
    if (failed.length > 0) {
      toast.error(`部分保存失败：${failed.join('；')}`, { duration: 8000 })
    } else {
      toast.success('测试参数已保存并生效')
      setLlm({ apiKey: '', baseUrl: '', model: '' })
      setEmb({ apiKey: '', baseUrl: '', model: '' })
    }
    onSaved()
  }

  const llmKey = byKey.get('llm_api_key')
  const llmUrl = byKey.get('llm_base_url')
  const chatModel = byKey.get('llm_model')
  const embKey = byKey.get('embedding_api_key')
  const embUrl = byKey.get('embedding_base_url')
  const embModel = byKey.get('llm_embedding_model')

  const llmSummary = `当前：${endpointText(String(llmUrl?.value ?? ''))} · ${String(chatModel?.value ?? '') || '模型未设置'} · Key ${llmKey?.is_set ? '已设置' : '未设置'}`
  const embSummary = `当前：${
    embUrl?.is_set
      ? endpointText(String(embUrl.value))
      : `${endpointText(String(llmUrl?.value ?? ''))}（回退 LLM）`
  } · ${String(embModel?.value ?? '') || '模型未设置'} · Key ${
    embKey?.is_set ? '已设置' : `回退 LLM（${llmKey?.is_set ? '已设置' : '未设置'}）`
  }`

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4 text-primary" />
          API 连通性测试
        </CardTitle>
        <CardDescription>
          可临时填入新参数直接测试（不会保存）；测试通过后再一键保存为配置。探测结果会显示实际命中的端点与模型，便于排障。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TestSection
            title="LLM 对话"
            summary={llmSummary}
            draft={llm}
            onDraft={setLlm}
            apiKeyPlaceholder={llmKey?.is_set ? '******' : '未设置'}
            baseUrlPlaceholder={endpointText(String(llmUrl?.value ?? ''))}
            modelPlaceholder={String(chatModel?.value ?? '') || '未设置'}
            testing={testing}
            onTest={handleTest}
            probe={result?.chat ?? null}
          />
          <TestSection
            title="Embedding"
            summary={embSummary}
            draft={emb}
            onDraft={setEmb}
            apiKeyPlaceholder={embKey?.is_set ? '******' : '未单独设置（回退 LLM Key）'}
            baseUrlPlaceholder={
              embUrl?.is_set ? String(embUrl.value) : '未单独设置（回退 LLM Base URL）'
            }
            modelPlaceholder={String(embModel?.value ?? '') || '未设置'}
            testing={testing}
            onTest={handleTest}
            probe={result?.embedding ?? null}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleTest} loading={testing} className="gap-1.5">
            <Plug className="h-3.5 w-3.5" />
            测试全部
          </Button>
          {hasDraft && (
            <Button size="sm" variant="outline" onClick={handleSaveDrafts} loading={saving} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              保存测试参数为配置
            </Button>
          )}
          {testing && <span className="text-xs text-muted-foreground">正在发起探测，最长约 40 秒…</span>}
        </div>
      </CardContent>
    </Card>
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
    if (!confirm(`确定将「${item.label}」恢复为默认值？当前的数据库覆盖值将被清除。`)) return
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
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{item.label}</p>
              <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{item.key}</code>
              {item.source === 'db' ? (
                <Badge variant="warning">已覆盖</Badge>
              ) : (
                <Badge variant="secondary">默认</Badge>
              )}
              {item.secret && (
                item.is_set ? <Badge variant="success">已设置</Badge> : <Badge variant="danger">未设置</Badge>
              )}
            </div>
            {item.description && (
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
            )}
            {!editing && (
              <p className="mt-1.5 break-all text-sm">
                {item.secret ? (
                  <span className="font-mono text-muted-foreground">{item.is_set ? '******' : '—'}</span>
                ) : (
                  <span className="font-mono">{displayValue(item) || '—'}</span>
                )}
              </p>
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
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={startEdit} className="gap-1">
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </Button>
              {item.source === 'db' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  loading={resetting}
                  className="gap-1 text-danger hover:text-danger hover:bg-danger/10"
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
      </CardContent>
    </Card>
  )
}

export default function AdminConfigPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [items, setItems] = useState<ConfigItem[]>([])
  const [loading, setLoading] = useState(true)

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

      <ConnectivityCard items={items} onSaved={load} />

      {GROUPS.map((group) => {
        const groupItems = group.keys
          .map((k) => byKey.get(k))
          .filter((i): i is ConfigItem => !!i)
        if (groupItems.length === 0) return null
        return (
          <div key={group.title} className="mb-8">
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{group.title}</h3>
            <div className="space-y-2">
              {groupItems.map((item) => (
                <ConfigRow
                  key={item.key}
                  item={item}
                  fallbackLabel={item.fallback_key ? byKey.get(item.fallback_key)?.label ?? null : null}
                  onChanged={load}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
