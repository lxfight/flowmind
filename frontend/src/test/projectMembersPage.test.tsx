import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectMembersPage from '../pages/ProjectMembersPage'
import api from '../utils/api'

const projectRoleState = vi.hoisted(() => ({ value: 'admin' }))
const authState = vi.hoisted(() => ({
  user: {
    id: 10,
    username: 'current-admin',
    email: 'admin@example.com',
    display_name: '当前管理员',
    avatar_url: '',
    is_superuser: false,
    is_approved: true,
    can_create_project: false,
  },
}))

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../utils/api')>('../utils/api')
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }
})

vi.mock('../hooks/useProjectRole', () => ({
  useProjectRole: () => projectRoleState.value,
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}))

const members = [
  {
    id: 1,
    user_id: 1,
    role: 'owner',
    username: 'owner',
    display_name: '项目所有者',
    avatar_url: '',
  },
  {
    id: 2,
    user_id: 20,
    role: 'admin',
    username: 'other-admin',
    display_name: '其他管理员',
    avatar_url: '',
  },
  {
    id: 3,
    user_id: 30,
    role: 'member',
    username: 'worker',
    display_name: '项目成员',
    avatar_url: '',
  },
]

function renderMembersPage() {
  return render(
    <MemoryRouter initialEntries={['/project/7/members']}>
      <Routes>
        <Route path="/project/:projectId/members" element={<ProjectMembersPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProjectMembersPage role hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectRoleState.value = 'admin'
    vi.mocked(api.get).mockResolvedValue({ data: members })
  })

  it('shows another administrator identity without management controls', async () => {
    renderMembersPage()

    expect(await screen.findByText('其他管理员')).toBeInTheDocument()
    expect(screen.getByText('管理员')).toBeInTheDocument()
    expect(screen.queryByLabelText('修改 other-admin 的角色')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '移除成员 other-admin' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('修改 worker 的角色')).toHaveValue('member')
    expect(screen.getByRole('button', { name: '移除成员 worker' })).toBeInTheDocument()
  })

  it('lets the project owner manage an administrator role', async () => {
    projectRoleState.value = 'owner'
    renderMembersPage()

    expect(await screen.findByLabelText('修改 other-admin 的角色')).toHaveValue('admin')
    expect(screen.getByRole('button', { name: '移除成员 other-admin' })).toBeInTheDocument()
  })
})
