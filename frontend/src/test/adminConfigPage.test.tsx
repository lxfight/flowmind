import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdminConfigPage from '../pages/AdminConfigPage'
import { fetchConfigs, testConnection } from '../api/adminConfig'
import { useAuthStore } from '../stores/authStore'

vi.mock('../api/adminConfig', () => ({
  fetchConfigs: vi.fn(),
  updateConfig: vi.fn(),
  deleteConfig: vi.fn(),
  testConnection: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const baseItems = [
  { key: 'llm_api_key', label: 'LLM API Key', kind: 'str', secret: true, description: '', value: '', is_set: false, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'llm_base_url', label: 'LLM Base URL', kind: 'str', secret: false, description: '', value: 'https://api.openai.com/v1', is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'llm_model', label: 'Chat 模型', kind: 'str', secret: false, description: '', value: 'gpt-4o-mini', is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'llm_timeout', label: '对话请求超时(秒)', kind: 'float', secret: false, description: '', value: 60, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'embedding_api_key', label: 'Embedding API Key', kind: 'str', secret: true, description: '', value: '', is_set: false, source: 'env', fallback_key: 'llm_api_key', effective_source: 'llm_api_key', updated_at: null },
  { key: 'embedding_base_url', label: 'Embedding Base URL', kind: 'str', secret: false, description: '', value: '', is_set: false, source: 'env', fallback_key: 'llm_base_url', effective_source: 'llm_base_url', updated_at: null },
  { key: 'llm_embedding_model', label: 'Embedding 模型', kind: 'str', secret: false, description: '', value: 'text-embedding-3-small', is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'llm_embedding_dim', label: 'Embedding 维度', kind: 'int', secret: false, description: '', value: 1536, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'embedding_timeout', label: 'Embedding 超时(秒)', kind: 'float', secret: false, description: '', value: 30, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'embedding_max_retries', label: 'Embedding 重试次数', kind: 'int', secret: false, description: '', value: 4, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'embedding_retry_base_delay', label: 'Embedding 重试基础延迟(秒)', kind: 'float', secret: false, description: '', value: 2, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'embedding_concurrency', label: 'Embedding 并发数', kind: 'int', secret: false, description: '', value: 2, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'embedding_batch_size', label: 'Embedding 批量大小', kind: 'int', secret: false, description: '', value: 8, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'chunk_size', label: '分块大小', kind: 'int', secret: false, description: '', value: 512, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'chunk_overlap', label: '分块重叠', kind: 'int', secret: false, description: '', value: 64, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'top_k_retrieval', label: '检索条数', kind: 'int', secret: false, description: '', value: 5, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'similarity_threshold', label: '相似度阈值', kind: 'float', secret: false, description: '', value: 0.35, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'knowledge_max_bytes', label: '知识库文件大小上限', kind: 'int', secret: false, description: '', value: 25 * 1024 * 1024, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'llm_report_timeout', label: '报告生成总超时(秒)', kind: 'float', secret: false, description: '', value: 180, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'llm_report_max_retries', label: '报告生成重试次数', kind: 'int', secret: false, description: '', value: 2, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
  { key: 'llm_report_retry_base_delay', label: '报告重试基础延迟(秒)', kind: 'float', secret: false, description: '', value: 1, is_set: true, source: 'env', fallback_key: null, effective_source: null, updated_at: null },
]

const probeOk = { ok: true, latency_ms: 120, error: null, base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }

describe('AdminConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ token: 'admin-token', user: { id: 1, username: 'admin', is_superuser: true } as any })
  })

  it('renders all five config groups including embedding stability and report params', async () => {
    vi.mocked(fetchConfigs).mockResolvedValue(baseItems as any)
    render(
      <MemoryRouter>
        <AdminConfigPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getAllByText('报告生成').length).toBeGreaterThan(0)
    })

    // Embedding stability params are now visible.
    expect(screen.getByText('Embedding 超时(秒)')).toBeInTheDocument()
    expect(screen.getByText('Embedding 重试次数')).toBeInTheDocument()
    expect(screen.getByText('Embedding 并发数')).toBeInTheDocument()
    expect(screen.getByText('对话请求超时(秒)')).toBeInTheDocument()
  })

  it('tests LLM and Embedding probes independently with per-section results', async () => {
    vi.mocked(fetchConfigs).mockResolvedValue(baseItems as any)
    vi.mocked(testConnection).mockResolvedValue({ chat: probeOk, embedding: { ...probeOk, model: 'text-embedding-3-small' } } as any)

    render(
      <MemoryRouter>
        <AdminConfigPage />
      </MemoryRouter>,
    )
    await screen.findAllByText('报告生成')

    // Click the section-level test button for Embedding only.
    const embTestButton = screen.getAllByRole('button', { name: /测试Embedding/ })[0]
    await userEvent.click(embTestButton)

    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledTimes(1)
    })
    // Only the embedding section shows a success probe.
    await waitFor(() => {
      expect(screen.getAllByText('成功').length).toBeGreaterThan(0)
    })
  })

  it('collapses a group and hides its config rows', async () => {
    vi.mocked(fetchConfigs).mockResolvedValue(baseItems as any)
    render(
      <MemoryRouter>
        <AdminConfigPage />
      </MemoryRouter>,
    )
    await screen.findAllByText('报告生成')

    // Config rows in the group are visible initially.
    expect(screen.getByText('报告生成总超时(秒)')).toBeInTheDocument()

    // Click the collapsible group header (the nav pill is a different button
    // without aria-expanded — target the header specifically).
    const header = screen.getByRole('button', { name: /报告生成.*项/ })
    await userEvent.click(header)

    await waitFor(() => {
      expect(screen.queryByText('报告生成总超时(秒)')).not.toBeInTheDocument()
    })
  })
})
