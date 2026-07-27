import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectReportPage from '../pages/ProjectReportPage'
import api from '../utils/api'
import toast from 'react-hot-toast'

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../utils/api')>('../utils/api')
  return { ...actual, default: { post: vi.fn() } }
})

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn() },
}))

function ReportRoute({ canSwitch = false, canLeave = false }: { canSwitch?: boolean; canLeave?: boolean }) {
  const navigate = useNavigate()
  return (
    <>
      {canSwitch && <button onClick={() => navigate('/projects/2/report')}>切换项目</button>}
      {canLeave && <button onClick={() => navigate('/projects/1/board')}>离开报告</button>}
      {canLeave && <button onClick={() => navigate('/projects/1/report')}>返回报告</button>}
      <Routes>
        <Route path="/projects/:projectId/report" element={<ProjectReportPage />} />
        <Route path="/projects/:projectId/board" element={<p>项目看板</p>} />
      </Routes>
    </>
  )
}

function renderReport(projectId = '1', canSwitch = false, canLeave = false) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/report`]}>
      <ReportRoute canSwitch={canSwitch} canLeave={canLeave} />
    </MemoryRouter>,
  )
}

function generateButton() {
  return screen.getAllByRole('button', { name: '生成报告' })[0]
}

describe('ProjectReportPage reliability', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('ignores malformed cache and history entries', () => {
    sessionStorage.setItem('flowmind_report_cache_1', JSON.stringify({ report: 123, generated_at: 'bad' }))
    localStorage.setItem('flowmind_report_history_1', JSON.stringify([
      { report: '', generated_at: '2026-07-27T00:00:00Z' },
      { report: 'missing date' },
    ]))

    renderReport()

    expect(generateButton()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '历史' })).not.toBeInTheDocument()
  })

  it('renders cached report markdown with GFM structure', () => {
    sessionStorage.setItem('flowmind_report_cache_1', JSON.stringify({
      report: '# 迭代报告\n\n- 已完成登录优化\n- 正在处理通知跳转\n\n| 指标 | 数值 |\n| --- | --- |\n| 完成率 | 80% |',
      generated_at: '2026-07-27T10:00:00Z',
    }))

    renderReport()

    expect(screen.getByRole('heading', { name: '迭代报告', level: 1 })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '指标' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '80%' })).toBeInTheDocument()
  })

  it('surfaces the backend report error detail', async () => {
    const user = userEvent.setup()
    const error = Object.assign(new Error('request failed'), {
      isAxiosError: true,
      response: { status: 502, data: { detail: '模型返回的报告不完整，请重试' } },
    })
    vi.mocked(api.post).mockRejectedValue(error)
    renderReport()

    await user.click(generateButton())

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('模型返回的报告不完整，请重试')
    })
  })

  it('rejects a malformed API response before caching it', async () => {
    const user = userEvent.setup()
    vi.mocked(api.post).mockResolvedValue({ data: { report: null, generated_at: 'invalid' } })
    renderReport()

    await user.click(generateButton())

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('模型返回的报告格式无效，请重试')
    })
    expect(sessionStorage.getItem('flowmind_report_cache_1')).toBeNull()
  })

  it('keeps generating for the original project without overwriting the newly selected project', async () => {
    const user = userEvent.setup()
    let resolveRequest: (value: { data: { report: string; generated_at: string } }) => void = () => {}
    const pending = new Promise<{ data: { report: string; generated_at: string } }>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(api.post).mockReturnValue(pending)
    sessionStorage.setItem('flowmind_report_cache_2', JSON.stringify({
      report: '项目二缓存报告',
      generated_at: '2026-07-27T08:00:00Z',
    }))
    renderReport('1', true)

    await user.click(generateButton())
    await user.click(screen.getByRole('button', { name: '切换项目' }))

    expect(await screen.findByText('项目二缓存报告')).toBeInTheDocument()
    expect(vi.mocked(api.post).mock.calls[0][2]?.signal).toBeUndefined()

    await act(async () => {
      resolveRequest({
        data: { report: '项目一迟到报告', generated_at: '2026-07-27T09:00:00Z' },
      })
      await pending
    })

    expect(screen.queryByText('项目一迟到报告')).not.toBeInTheDocument()
    expect(screen.getByText('项目二缓存报告')).toBeInTheDocument()
    expect(sessionStorage.getItem('flowmind_report_cache_1')).toContain('项目一迟到报告')
  })

  it('restores an in-progress generation after leaving and returning to the report page', async () => {
    const user = userEvent.setup()
    let resolveRequest: (value: { data: { report: string; generated_at: string } }) => void = () => {}
    const pending = new Promise<{ data: { report: string; generated_at: string } }>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(api.post).mockReturnValue(pending)
    renderReport('1', false, true)

    await user.click(generateButton())
    expect(screen.getByText('正在生成项目报告')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '离开报告' }))
    expect(screen.getByText('项目看板')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回报告' }))
    expect(await screen.findByText('正在生成项目报告')).toBeInTheDocument()

    await act(async () => {
      resolveRequest({
        data: { report: '跨页面完成的项目报告', generated_at: '2026-07-27T10:00:00Z' },
      })
      await pending
    })

    expect(await screen.findByText('跨页面完成的项目报告')).toBeInTheDocument()
    expect(sessionStorage.getItem('flowmind_report_cache_1')).toContain('跨页面完成的项目报告')
  })
})
