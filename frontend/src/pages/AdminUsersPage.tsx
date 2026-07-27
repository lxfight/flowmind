import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { Check, ChevronLeft, ChevronRight, Clock3, Key, RefreshCw, UserCheck, UserX, Users, X } from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Switch } from '../components/ui/Switch'
import { Badge } from '../components/ui/Badge'
import { Avatar } from '../components/ui/Avatar'
import { confirmAction } from '../components/ui/confirmAction'
import { cn } from '../utils/cn'

interface UserInfo {
  id: number
  username: string
  email: string
  display_name: string
  avatar_url: string
  is_active: boolean
  is_superuser: boolean
  is_approved: boolean
  can_create_project: boolean
  created_at: string
}

const PAGE_SIZE = 20

export default function AdminUsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<number | null>(null)

  const loadUsers = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const res = await api.get('/admin/users', { params: { page: p, page_size: PAGE_SIZE } })
      setUsers(res.data.items)
      setTotal(res.data.total)
      setPage(res.data.page)
    } catch {
      toast.error('加载用户列表失败')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (currentUser && !currentUser.is_superuser) {
      navigate('/')
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: async loader updates state after await
    loadUsers(1)
  }, [currentUser, loadUsers, navigate])

  const handleApprove = async (userId: number, canCreate: boolean) => {
    setActionId(userId)
    try {
      await api.post(`/admin/users/${userId}/approve?can_create_project=${canCreate}`)
      toast.success('用户已审批通过')
      loadUsers(page)
    } catch {
      toast.error('审批失败')
    }
    setActionId(null)
  }

  const handleReject = async (userId: number) => {
    if (!(await confirmAction({
      title: '禁用用户',
      description: '该用户将无法继续登录，已有项目数据不会被删除。',
      confirmLabel: '禁用用户',
      tone: 'warning',
      icon: 'warning',
    }))) return
    setActionId(userId)
    try {
      await api.post(`/admin/users/${userId}/reject`)
      toast.success('用户已禁用')
      loadUsers(page)
    } catch {
      toast.error('操作失败')
    }
    setActionId(null)
  }

  const handleActivate = async (userId: number) => {
    setActionId(userId)
    try {
      await api.post(`/admin/users/${userId}/activate`)
      toast.success('用户已启用')
      loadUsers(page)
    } catch {
      toast.error('操作失败')
    }
    setActionId(null)
  }

  const handleToggleCreateProject = async (userId: number, enabled: boolean) => {
    setActionId(userId)
    try {
      await api.put(`/admin/users/${userId}?can_create_project=${!enabled}`)
      toast.success('权限已更新')
      loadUsers(page)
    } catch {
      toast.error('更新失败')
    }
    setActionId(null)
  }

  const handleResetPassword = async (userId: number) => {
    if (!(await confirmAction({
      title: '重置用户密码',
      description: '系统将生成新的随机密码，原密码会立即失效。',
      confirmLabel: '重置密码',
      tone: 'warning',
      icon: 'reset',
    }))) return
    setActionId(userId)
    try {
      const res = await api.post(`/admin/users/${userId}/reset-password`)
      toast.success(`密码已重置为: ${res.data.new_password}`, { duration: 8000 })
    } catch {
      toast.error('重置失败')
    }
    setActionId(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const pendingUsers = users.filter(u => !u.is_approved && u.is_active)
  const activeUsers = users.filter(u => u.is_approved && u.is_active)
  const disabledUsers = users.filter(u => !u.is_active)

  return (
    <div className="mx-auto h-full w-full max-w-[1600px] overflow-y-auto">
      <PageHeader title="用户管理" description="审批、禁用、重置密码及管理项目创建权限" />

        <section className="mb-8 grid border-y border-border sm:grid-cols-3" aria-label="用户概览">
          {[
            { label: '待审批', value: pendingUsers.length, icon: Clock3, tone: pendingUsers.length > 0 ? 'text-warning' : 'text-muted-foreground' },
            { label: '活跃用户', value: activeUsers.length, icon: UserCheck, tone: 'text-success' },
            { label: '已禁用', value: disabledUsers.length, icon: UserX, tone: disabledUsers.length > 0 ? 'text-danger' : 'text-muted-foreground' },
          ].map((metric) => {
            const Icon = metric.icon
            return (
              <div key={metric.label} className="flex items-end justify-between border-b border-border px-4 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground">{metric.label}</p>
                  <p className="tnum mt-2 text-3xl font-semibold leading-none text-foreground">{String(metric.value).padStart(2, '0')}</p>
                </div>
                <Icon className={cn('h-4 w-4', metric.tone)} />
              </div>
            )
          })}
        </section>

        {pendingUsers.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-warning mb-3 flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              待审批 ({pendingUsers.length})
            </h3>
            <div className="divide-y divide-border/70 border-y border-warning/30 bg-warning/[0.025]">
              {pendingUsers.map((u) => (
                <div key={u.id} className="flex flex-col justify-between gap-4 px-3 py-4 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={u.display_name || u.username} src={u.avatar_url} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{u.display_name || u.username}</p>
                        <p className="text-xs text-muted-foreground truncate">@{u.username} · {u.email}</p>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(u.id, false)}
                        disabled={actionId === u.id}
                        className="gap-1"
                      >
                        <Check className="h-3.5 w-3.5" />
                        通过
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReject(u.id)}
                        disabled={actionId === u.id}
                        className="gap-1"
                      >
                        <X className="h-3.5 w-3.5" />
                        拒绝
                      </Button>
                    </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            活跃用户 ({activeUsers.length})
          </h3>
          <div className="divide-y divide-border/70 border-y border-border">
            {activeUsers.map((u) => (
              <div key={u.id} className="px-3 py-4 transition-colors hover:bg-muted/20">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.display_name || u.username} src={u.avatar_url} size="sm" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{u.display_name || u.username}</p>
                          {u.is_superuser && <Badge variant="primary">管理员</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">@{u.username} · {u.email}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={u.can_create_project}
                          onCheckedChange={() => handleToggleCreateProject(u.id, u.can_create_project)}
                          disabled={actionId === u.id}
                          aria-label="允许创建项目"
                        />
                        <span
                          className={cn(
                            'text-xs font-medium',
                            u.can_create_project ? 'text-success' : 'text-muted-foreground'
                          )}
                        >
                          {u.can_create_project ? '可创建项目' : '不可创建项目'}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResetPassword(u.id)}
                        disabled={actionId === u.id}
                        className="gap-1"
                      >
                        <Key className="h-3.5 w-3.5" />
                        重置密码
                      </Button>
                      {!u.is_superuser && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleReject(u.id)}
                          disabled={actionId === u.id}
                          className="gap-1 text-danger hover:text-danger hover:bg-danger/10"
                        >
                          <X className="h-3.5 w-3.5" />
                          禁用
                        </Button>
                      )}
                    </div>
                  </div>
              </div>
            ))}
          </div>
        </div>

        {disabledUsers.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">
              已禁用 ({disabledUsers.length})
            </h3>
            <div className="divide-y divide-border/60 border-y border-border opacity-65">
              {disabledUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-4 px-3 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.display_name || u.username} src={u.avatar_url} size="sm" />
                      <div>
                        <p className="font-medium text-sm line-through">{u.display_name || u.username}</p>
                        <p className="text-xs text-muted-foreground">@{u.username}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleActivate(u.id)}
                      disabled={actionId === u.id}
                      className="gap-1 text-success hover:text-success hover:bg-success/10"
                    >
                      <Check className="h-3.5 w-3.5" />
                      启用
                    </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page <= 1}
              onClick={() => loadUsers(page - 1)}
              aria-label="上一页"
              title="上一页"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              第 {page} / {Math.ceil(total / PAGE_SIZE)} 页（共 {total} 人）
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= Math.ceil(total / PAGE_SIZE)}
              onClick={() => loadUsers(page + 1)}
              aria-label="下一页"
              title="下一页"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
    </div>
  )
}
