import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { Users, Check, X, RefreshCw, ToggleLeft, ToggleRight, Shield, Key } from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'

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
      <div className="p-6 flex items-center justify-center">
        <RefreshCw size={24} className="animate-spin text-primary-500" />
      </div>
    )
  }

  const pendingUsers = users.filter(u => !u.is_approved && u.is_active)
  const activeUsers = users.filter(u => u.is_approved && u.is_active)
  const disabledUsers = users.filter(u => !u.is_active)

  return (
    <div className="p-6 h-full overflow-y-auto dark:text-gray-100">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Shield size={22} className="text-primary-500" />
          <h2 className="text-xl font-bold">用户管理</h2>
        </div>

        {/* Pending approvals */}
        {pendingUsers.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 mb-3 flex items-center gap-1.5">
              <Users size={14} />
              待审批 ({pendingUsers.length})
            </h3>
            <div className="space-y-2">
              {pendingUsers.map((u) => (
                <div key={u.id} className="card p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 flex items-center justify-center text-sm font-medium flex-shrink-0">
                      {(u.display_name || u.username).charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{u.display_name || u.username}</p>
                      <p className="text-xs text-gray-400">@{u.username} · {u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
                      onClick={() => handleApprove(u.id, false)}
                      disabled={actionId === u.id}
                    >
                      <Check size={13} /> 通过
                    </button>
                    <button
                      className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1"
                      onClick={() => handleReject(u.id)}
                      disabled={actionId === u.id}
                    >
                      <X size={13} /> 拒绝
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active users */}
        <div>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3">
            活跃用户 ({activeUsers.length})
          </h3>
          <div className="space-y-2">
            {activeUsers.map((u) => (
              <div key={u.id} className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 flex items-center justify-center text-sm font-medium">
                      {(u.display_name || u.username).charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{u.display_name || u.username}</p>
                        {u.is_superuser && (
                          <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded">管理员</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">@{u.username} · {u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Create project toggle */}
                    <button
                      className="text-xs flex items-center gap-1 text-gray-500 hover:text-primary-600"
                      onClick={() => handleToggleCreateProject(u.id, u.can_create_project)}
                      disabled={actionId === u.id}
                    >
                      {u.can_create_project ? (
                        <ToggleRight size={16} className="text-green-500" />
                      ) : (
                        <ToggleLeft size={16} />
                      )}
                      创建项目
                    </button>
                    {/* Reset password */}
                    <button
                      className="btn-ghost text-xs flex items-center gap-1"
                      onClick={() => handleResetPassword(u.id)}
                      disabled={actionId === u.id}
                    >
                      <Key size={13} />
                      重置密码
                    </button>
                    {/* Disable */}
                    {!u.is_superuser && (
                      <button
                        className="btn-ghost text-xs text-red-500 flex items-center gap-1"
                        onClick={() => handleReject(u.id)}
                        disabled={actionId === u.id}
                      >
                        <X size={13} />
                        禁用
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Disabled users */}
        {disabledUsers.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">
              已禁用 ({disabledUsers.length})
            </h3>
            <div className="space-y-2">
              {disabledUsers.map((u) => (
                <div key={u.id} className="card p-4 opacity-60 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium">
                      {(u.display_name || u.username).charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-sm line-through">{u.display_name || u.username}</p>
                      <p className="text-xs text-gray-400">@{u.username}</p>
                    </div>
                  </div>
                  <button
                    className="btn-ghost text-xs text-green-600 flex items-center gap-1"
                    onClick={() => handleActivate(u.id)}
                    disabled={actionId === u.id}
                  >
                    <Check size={13} /> 启用
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
