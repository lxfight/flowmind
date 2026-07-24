import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SystemUpdatePage from '../pages/SystemUpdatePage'
import {
  fetchUpdateHistory,
  fetchUpdateStatus,
  type UpdateOverview,
} from '../api/systemUpdate'

vi.mock('../api/systemUpdate', async () => {
  const actual = await vi.importActual<typeof import('../api/systemUpdate')>('../api/systemUpdate')
  return {
    ...actual,
    fetchUpdateStatus: vi.fn(),
    fetchUpdateHistory: vi.fn(),
    checkForUpdates: vi.fn(),
    applyUpdate: vi.fn(),
    rollbackUpdate: vi.fn(),
  }
})

const overview: UpdateOverview = {
  current: { version: '0.1.0', git_sha: 'abc123', build_time: '2026-07-24T00:00:00Z' },
  latest: {
    version: '0.2.0',
    tag_name: 'v0.2.0',
    name: 'FlowMind 0.2.0',
    body: '## 更新内容\n\n- 支持安全更新',
    published_at: '2026-07-24T01:00:00Z',
    html_url: 'https://github.com/lxfight/flowmind/releases/tag/v0.2.0',
    prerelease: false,
  },
  update_available: true,
  checked_at: '2026-07-24T01:00:00Z',
  check_error: null,
  updater: {
    available: true,
    status: 'idle',
    progress: 0,
    message: 'updater 已就绪',
    rollback_available: false,
  },
}

describe('SystemUpdatePage', () => {
  beforeEach(() => {
    vi.mocked(fetchUpdateStatus).mockResolvedValue(overview)
    vi.mocked(fetchUpdateHistory).mockResolvedValue([])
  })

  it('shows version metadata, release notes and an enabled update command', async () => {
    render(<SystemUpdatePage />)

    await waitFor(() => expect(screen.getByText('0.1.0')).toBeInTheDocument())
    expect(screen.getByText('0.2.0')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '更新内容' })).toBeInTheDocument()
    expect(screen.getByText('支持安全更新')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更新到 0.2.0' })).toBeEnabled()
    expect(screen.getByText('updater 已就绪')).toBeInTheDocument()
  })
})
