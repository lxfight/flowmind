import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useProjectStore, type Project } from '../../stores/projectStore'
import { AppShell } from '../layout/AppShell'
import api from '../../utils/api'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const { projects, currentProject, setProjects, setCurrentProject } = useProjectStore()
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

  const handleSelectProject = (project: Project) => {
    setCurrentProject(project)
  }

  return (
    <AppShell
      projects={projects}
      currentProject={currentProject}
      user={user}
      onSelectProject={handleSelectProject}
      onLogout={handleLogout}
    >
      <Outlet />
    </AppShell>
  )
}
