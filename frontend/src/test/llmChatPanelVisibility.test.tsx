import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// --- Mocks -----------------------------------------------------------------

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ projectId: '1' }) }
})

vi.mock('../hooks/useProjectRole', () => ({
  useProjectRole: () => 'owner',
}))

vi.mock('../hooks/useProjectSocket', () => ({
  useProjectSocket: () => {},
}))

vi.mock('../utils/api', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url.includes('/statuses')) return Promise.resolve({ data: [
        { id: 1, name: '待办', order: 0, project_id: 1 },
      ] })
      if (url.includes('/tasks')) return Promise.resolve({ data: { items: [] } })
      if (url.includes('/members')) return Promise.resolve({ data: [] })
      if (url.includes('/llm/sessions')) return Promise.resolve({ data: [] })
      return Promise.resolve({ data: {} })
    }),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}))

vi.mock('../components/kanban/TaskDetailDialog', () => ({
  TaskDetailDialog: ({ taskId, focusCommentId }: { taskId: number; focusCommentId?: number | null }) => (
    <div data-testid="task-detail-target">{taskId}:{focusCommentId ?? 'none'}</div>
  ),
}))

import KanbanBoard from '../components/kanban/KanbanBoard'

// --- Tests -----------------------------------------------------------------

function renderBoard(entry = '/project/1/board') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <KanbanBoard />
    </MemoryRouter>
  )
}

describe('LLM chat floating window (KanbanBoard integration)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows the floating trigger button on the board when the window is closed', async () => {
    renderBoard()
    await screen.findByText('任务看板')
    const trigger = await screen.findByRole('button', { name: '打开 LLM 助手' })
    expect(trigger).toBeInTheDocument()
  })

  it('opens the floating window (role=dialog) when the trigger is clicked', async () => {
    renderBoard()
    const trigger = await screen.findByRole('button', { name: '打开 LLM 助手' })
    await userEvent.click(trigger)

    const panel = await screen.findByRole('dialog', { name: 'LLM 助手面板' })
    expect(panel).toBeInTheDocument()

    // Fixed positioning — the board is no longer compressed by a flex sibling
    expect(panel.className).toContain('fixed')

    // After the enter animation frames the window must actually become visible
    await waitFor(() => {
      expect(panel).toHaveStyle({ opacity: '1' })
    }, { timeout: 2000 })

    // Trigger hides while the window is open
    expect(screen.queryByRole('button', { name: '打开 LLM 助手' })).not.toBeInTheDocument()
  })

  it('opens the window from the toolbar button as well', async () => {
    renderBoard()
    const btn = await screen.findByRole('button', { name: 'LLM 助手' })
    await userEvent.click(btn)
    const panel = await screen.findByRole('dialog', { name: 'LLM 助手面板' })
    await waitFor(() => {
      expect(panel).toHaveStyle({ opacity: '1' })
    }, { timeout: 2000 })
  })

  it('restores the open state from localStorage', async () => {
    localStorage.setItem('flowmind.llmChatOpen', '1')
    renderBoard()
    const panel = await screen.findByRole('dialog', { name: 'LLM 助手面板' })
    expect(panel).toBeInTheDocument()
  })

  it('closes via the header close button and shows the trigger again', async () => {
    renderBoard()
    const trigger = await screen.findByRole('button', { name: '打开 LLM 助手' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'LLM 助手面板' })

    await userEvent.click(screen.getByRole('button', { name: '关闭助手面板' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'LLM 助手面板' })).not.toBeInTheDocument()
    }, { timeout: 2000 })
    expect(await screen.findByRole('button', { name: '打开 LLM 助手' })).toBeInTheDocument()
  })

  it('uses a full-screen conversation surface on narrow viewports', async () => {
    const previousWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    try {
      renderBoard()
      const trigger = await screen.findByRole('button', { name: '打开 LLM 助手' })
      await userEvent.click(trigger)

      const panel = await screen.findByRole('dialog', { name: 'LLM 助手面板' })
      expect(panel).toHaveStyle({ left: '0px', top: '0px', width: '100vw', height: '100dvh' })
      expect(screen.queryByRole('separator', { name: '调整窗口大小' })).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth })
    }
  })

  it('opens the exact task and comment from a notification deep link', async () => {
    renderBoard('/project/1/board?task=42&comment=7')

    expect(await screen.findByTestId('task-detail-target')).toHaveTextContent('42:7')
  })
})
