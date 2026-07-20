import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useProjectStore } from '../../stores/projectStore'
import { AppShell } from '../layout/AppShell'
import api from '../../utils/api'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const { projects, currentProject, setProjects } = useProjectStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (projects.length === 0) {
      api.get('/projects').then((res) => setProjects(res.data))
    }
  }, [setProjects, projects.length])

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
