import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './stores/authStore'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ProjectPage = lazy(() => import('./pages/ProjectPage'))
const KanbanView = lazy(() => import('./pages/KanbanView'))
const KnowledgePage = lazy(() => import('./pages/KnowledgePage'))
const ProjectMembersPage = lazy(() => import('./pages/ProjectMembersPage'))
const ProjectReportPage = lazy(() => import('./pages/ProjectReportPage'))
const ActivityPage = lazy(() => import('./pages/ActivityPage'))
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const Layout = lazy(() => import('./components/common/Layout'))

const queryClient = new QueryClient()

function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">正在验证登录状态...</div>
    </div>
  )
}

function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">正在加载...</div>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const initialized = useAuthStore((s) => s.initialized)
  const loadUser = useAuthStore((s) => s.loadUser)

  useEffect(() => {
    if (token && !user && !loading) {
      loadUser()
    }
  }, [token, user, loading, loadUser])

  if (!token) return <Navigate to="/login" replace />
  if (!initialized || loading || !user) return <AuthLoading />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (!user) return <AuthLoading />
  if (!user.is_superuser) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="project/:projectId" element={<ProjectPage />}>
                <Route index element={<Navigate to="board" replace />} />
                <Route path="board" element={<KanbanView />} />
                <Route path="knowledge" element={<KnowledgePage />} />
                <Route path="members" element={<ProjectMembersPage />} />
                <Route path="report" element={<ProjectReportPage />} />
                <Route path="activities" element={<ActivityPage />} />
              </Route>
              <Route path="profile" element={<ProfilePage />} />
              <Route
                path="admin/users"
                element={
                  <AdminRoute>
                    <AdminUsersPage />
                  </AdminRoute>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster position="top-right" />
    </QueryClientProvider>
  )
}
