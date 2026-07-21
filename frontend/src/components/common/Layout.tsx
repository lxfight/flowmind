import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useProjectStore } from '../../stores/projectStore'
import { AppShell } from '../layout/AppShell'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const { currentProject, loadProjects } = useProjectStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Refetch on every route change so membership/project changes made
  // elsewhere are reflected, without polling.
  useEffect(() => {
    void loadProjects()
  }, [pathname, loadProjects])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <AppShell
      currentProject={currentProject}
      user={user}
      onLogout={handleLogout}
    >
      <Outlet />
    </AppShell>
  )
}
