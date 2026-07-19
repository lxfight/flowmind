import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { Users, Check, X, RefreshCw, ToggleLeft, ToggleRight, Shield, Key } from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Avatar } from '../components/ui/Avatar'

interface UserInfo {
  id: number
  username: string
  email: string
  display_name: string
  is_active: boolean
  is_superuser: boolean
  is_approved: boolean
  can_create_project: boolean
  created_at: string
}

export default function AdminUsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<number | null>(null)

  useEffect(() => {
    if (currentUser && !currentUser.is_superuser) {
      navigate('/')
      return
    }
    loadUsers()
  }, [currentUser])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const res = await api.get('/admin/users')
      setUsers(res.data)
    } catch {
      toast.error('加载用户列表失败')
    }
    setLoading(false)
  }

  const handleApprove = async (userId: number, canCreate: boolean) => {
    setActionId(userId)
    try {
      await api.post(`/admin/users/${userId}/approve?can_create_project=${canCreate}`)
      toast.success('用户已审批通过')
      loadUsers()
    } catch {
      toast.error('审批失败')
    }
    setActionId(null)
  }

  const handleReject = async (userId: number) => {
    if (!confirm('确定禁用该用户？')) return
    setActionId(userId)
    try {
      await api.post(`/admin/users/${userId}/reject`)
      toast.success('用户已禁用')
      loadUsers()
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
      loadUsers()
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
      loadUsers()
    } catch {
      toast.error('更新失败')
    }
    setActionId(null)
  }

  const handleResetPassword = async (userId: number) => {
    if (!confirm('确定重置该用户密码？新密码将随机生成。')) return
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
      <div className="page-container flex items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const pendingUsers = users.filter(u => !u.is_approved && u.is_active)
  const activeUsers = users.filter(u => u.is_approved && u.is_active)
  const disabledUsers = users.filter(u => !u.is_active)

  return (
    <div className="page-container h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-2 mb-6">
          <Shield className="h-6 w-6 text-primary" />
          <h2 className="page-title">用户管理</h2>
        </div>

        {pendingUsers.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-warning mb-3 flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              待审批 ({pendingUsers.length})
            </h3>
            <div className="space-y-2">
              {pendingUsers.map((u) => (
                <Card key={u.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={u.display_name || u.username} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{u.display_name || u.username}</p>
                        <p className="text-xs text-muted-foreground truncate">@{u.username} · {u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
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
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            活跃用户 ({activeUsers.length})
          </h3>
          <div className="space-y-2">
            {activeUsers.map((u) => (
              <Card key={u.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.display_name || u.username} size="sm" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{u.display_name || u.username}</p>
                          {u.is_superuser && <Badge variant="primary">管理员</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">@{u.username} · {u.email}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleCreateProject(u.id, u.can_create_project)}
                        disabled={actionId === u.id}
                        className="gap-1 text-muted-foreground hover:text-foreground"
                      >
                        {u.can_create_project ? (
                          <ToggleRight className="h-4 w-4 text-success" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                        创建项目
                      </Button>
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
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {disabledUsers.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">
              已禁用 ({disabledUsers.length})
            </h3>
            <div className="space-y-2">
              {disabledUsers.map((u) => (
                <Card key={u.id} className="opacity-60">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.display_name || u.username} size="sm" />
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
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
