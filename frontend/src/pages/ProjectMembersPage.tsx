import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Search, UserPlus, X, Trash2, Users } from 'lucide-react'
import api from '../utils/api'
import { useProjectRole } from '../hooks/useProjectRole'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Card, CardContent } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Avatar } from '../components/ui/Avatar'
import { EmptyState } from '../components/ui/EmptyState'
import type { ProjectMember, UserInfo } from '../types'

const ROLE_CONFIG: Record<string, { label: string; variant: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'outline' }> = {
  owner: { label: '所有者', variant: 'warning' },
  admin: { label: '管理员', variant: 'primary' },
  member: { label: '成员', variant: 'secondary' },
  viewer: { label: '查看者', variant: 'outline' },
}

export default function ProjectMembersPage() {
  const { projectId } = useParams()
  const userRole = useProjectRole()
  const currentUser = useAuthStore((s) => s.user)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserInfo[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null)

  const loadMembers = useCallback(async () => {
    if (!projectId) return
    const res = await api.get(`/projects/${projectId}/members`)
    setMembers(res.data)
  }, [projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: async loader updates state after await
    loadMembers()
  }, [loadMembers])

  useEffect(() => {
    if (!searchQuery.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale search results when the query is emptied
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await api.get(`/projects/users/search?q=${encodeURIComponent(searchQuery)}`)
        setSearchResults(
          res.data.filter((u: UserInfo) => !members.find((m) => m.user_id === u.id))
        )
      } catch {
        setSearchResults([])
      }
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, members])

  const handleAddMember = async (userId: number) => {
    if (!projectId) return
    setAdding(true)
    try {
      await api.post(`/projects/${projectId}/members`, { user_id: userId, role: 'member' })
      toast.success('成员添加成功')
      setShowAdd(false)
      setSearchQuery('')
      setSearchResults([])
      loadMembers()
    } catch {
      toast.error('添加失败')
    }
    setAdding(false)
  }

  const handleRemoveMember = async (userId: number, username: string) => {
    if (!projectId) return
    if (!confirm(`确定移除成员 ${username}？`)) return
    try {
      await api.delete(`/projects/${projectId}/members/${userId}`)
      toast.success('成员已移除')
      loadMembers()
    } catch {
      toast.error('移除失败')
    }
  }

  const handleRoleChange = async (member: ProjectMember, role: string) => {
    if (!projectId || role === member.role) return
    setUpdatingUserId(member.user_id)
    try {
      await api.put(`/projects/${projectId}/members/${member.user_id}`, { role })
      toast.success('角色已更新')
      loadMembers()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '更新角色失败')
    } finally {
      setUpdatingUserId(null)
    }
  }

  const canManage = userRole === 'owner' || userRole === 'admin'

  const RoleBadge = ({ role }: { role: string }) => {
    const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.member
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>
  }

  const RoleSelect = ({ member }: { member: ProjectMember }) => {
    const available = userRole === 'owner'
      ? [
          { value: 'admin', label: '管理员' },
          { value: 'member', label: '成员' },
          { value: 'viewer', label: '查看者' },
        ]
      : [
          { value: 'member', label: '成员' },
          { value: 'viewer', label: '查看者' },
        ]
    return (
      <Select
        value={member.role}
        onChange={(e) => handleRoleChange(member, e.target.value)}
        disabled={updatingUserId === member.user_id}
        className="h-7 text-xs w-28"
        aria-label={`修改 ${member.username} 的角色`}
      >
        {available.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </Select>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <PageHeader
        title="项目成员"
        description="管理项目成员及其权限"
        actions={
          canManage && (
            <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5">
              <UserPlus className="h-4 w-4" />
              添加成员
            </Button>
          )
        }
      />

      {showAdd && (
        <Card className="mb-6">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input
                placeholder="搜索用户名或昵称..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                onClick={() => { setShowAdd(false); setSearchQuery(''); setSearchResults([]) }}
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {searching && <p className="text-sm text-muted-foreground">搜索中...</p>}
            {searchResults.length > 0 && (
              <div className="space-y-1">
                {searchResults.map((u) => (
                  <div key={u.id} className="flex items-center justify-between rounded-lg p-2 hover:bg-accent">
                    <div className="flex items-center gap-2">
                      <Avatar name={u.display_name || u.username} src={u.avatar_url} size="sm" />
                      <div>
                        <p className="text-sm font-medium">{u.display_name || u.username}</p>
                        <p className="text-xs text-muted-foreground">@{u.username}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleAddMember(u.id)}
                      disabled={adding}
                      loading={adding}
                    >
                      添加
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {searchQuery && !searching && searchResults.length === 0 && (
              <p className="text-sm text-muted-foreground">未找到用户</p>
            )}
          </CardContent>
        </Card>
      )}

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="暂无成员"
          description="添加成员到项目协作"
        />
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={m.display_name || m.username} src={m.avatar_url} size="md" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{m.display_name || m.username}</p>
                      {canManage && m.role !== 'owner' && m.user_id !== currentUser?.id ? (
                        <RoleSelect member={m} />
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">@{m.username}</p>
                  </div>
                </div>
                {canManage && m.role !== 'owner' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-danger"
                    onClick={() => handleRemoveMember(m.user_id, m.username)}
                    aria-label={`移除成员 ${m.username}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
