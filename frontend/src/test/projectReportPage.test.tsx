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

function ReportRoute({ canSwitch = false }: { canSwitch?: boolean }) {
  const navigate = useNavigate()
  return (
    <>
      {canSwitch && <button onClick={() => navigate('/projects/2/report')}>切换项目</button>}
      <Routes>
        <Route path="/projects/:projectId/report" element={<ProjectReportPage />} />
      </Routes>
    </>
  )
}

function renderReport(projectId = '1', canSwitch = false) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/report`]}>
      <ReportRoute canSwitch={canSwitch} />
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

  it('does not let a stale response overwrite the newly selected project', async () => {
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
    const requestConfig = vi.mocked(api.post).mock.calls[0][2]
    await user.click(screen.getByRole('button', { name: '切换项目' }))

    expect(await screen.findByText('项目二缓存报告')).toBeInTheDocument()
    expect(requestConfig?.signal?.aborted).toBe(true)

    await act(async () => {
      resolveRequest({
        data: { report: '项目一迟到报告', generated_at: '2026-07-27T09:00:00Z' },
      })
      await pending
    })

    expect(screen.queryByText('项目一迟到报告')).not.toBeInTheDocument()
    expect(screen.getByText('项目二缓存报告')).toBeInTheDocument()
    expect(sessionStorage.getItem('flowmind_report_cache_1')).toBeNull()
  })
})
