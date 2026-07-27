import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgePage from '../pages/KnowledgePage'
import api from '../utils/api'

const projectRoleState = vi.hoisted(() => ({ value: 'owner' }))

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../utils/api')>('../utils/api')
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }
})

vi.mock('../hooks/useProjectRole', () => ({
  useProjectRole: () => projectRoleState.value,
}))

const docs = [
  {
    id: 1,
    title: '产品需求说明',
    content: '项目范围与验收标准',
    file_type: 'pdf',
    chunk_count: 12,
    status: 'indexed',
    error_message: null,
    created_at: '2026-07-20T08:00:00Z',
  },
  {
    id: 2,
    title: '技术方案',
    content: '系统架构与接口约束',
    file_type: 'md',
    chunk_count: 4,
    status: 'indexing',
    error_message: null,
    created_at: '2026-07-21T08:00:00Z',
  },
  {
    id: 3,
    title: '旧版数据',
    content: '',
    file_type: 'csv',
    chunk_count: 0,
    status: 'failed',
    error_message: '内容解析失败',
    created_at: '2026-07-22T08:00:00Z',
  },
]

function renderKnowledgePage() {
  return render(
    <MemoryRouter initialEntries={['/project/7/knowledge']}>
      <Routes>
        <Route path="/project/:projectId/knowledge" element={<KnowledgePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('KnowledgePage document roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectRoleState.value = 'owner'
    vi.mocked(api.get).mockResolvedValue({
      data: { items: docs, total: docs.length, page: 1, page_size: 20 },
    })
  })

  it('renders compact document metadata and indexing states', async () => {
    renderKnowledgePage()

    expect(await screen.findByRole('region', { name: '知识文档列表' })).toBeInTheDocument()
    expect(screen.getByText('3 篇文档 · 1 篇可检索 · 1 篇处理中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看文档 产品需求说明' })).toBeInTheDocument()
    expect(screen.getByText('已索引')).toBeInTheDocument()
    expect(screen.getByText('索引中')).toBeInTheDocument()
    expect(screen.getByText('失败')).toHaveAttribute('title', '内容解析失败')
    expect(vi.mocked(api.get).mock.calls[0][1]?.params).toEqual({ page: 1, page_size: 20 })
  })

  it('hides document mutation controls from viewers', async () => {
    projectRoleState.value = 'viewer'
    renderKnowledgePage()

    expect(await screen.findByText('产品需求说明')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '上传文件到知识库' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加文档' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除 产品需求说明' })).not.toBeInTheDocument()
  })
})
