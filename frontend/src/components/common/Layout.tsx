import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useProjectStore, type Project } from '../../stores/projectStore'
import { useThemeStore } from '../../stores/themeStore'
import { AppShell } from '../layout/AppShell'
import api from '../../utils/api'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const { projects, setProjects, currentProject, setCurrentProject } = useProjectStore()
  const { theme, toggle } = useThemeStore()
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/projects').then((res) => setProjects(res.data))
  }, [setProjects])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleSelectProject = (project: Project) => {
    setCurrentProject(project)
  }

  return (
    <AppShell
      projects={projects}
      currentProject={currentProject}
      user={user}
      theme={theme}
      onToggleTheme={toggle}
      onSelectProject={handleSelectProject}
      onLogout={handleLogout}
    >
      <Outlet />
    </AppShell>
  )
}
