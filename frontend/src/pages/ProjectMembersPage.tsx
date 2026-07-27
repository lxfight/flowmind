import { useState, useEffect, useCallback, type ComponentType } from 'react'
import { useParams } from 'react-router-dom'
import {
  Crown,
  Eye,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import api, { errDetail } from '../utils/api'
import { useProjectRole } from '../hooks/useProjectRole'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { Avatar } from '../components/ui/Avatar'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../utils/cn'
import type { ProjectMember, UserInfo } from '../types'

const ROLE_CONFIG: Record<string, {
  label: string
  variant: 'primary' | 'secondary' | 'warning' | 'outline'
  icon: ComponentType<{ className?: string }>
}> = {
  owner: { label: '所有者', variant: 'warning', icon: Crown },
  admin: { label: '管理员', variant: 'primary', icon: ShieldCheck },
  member: { label: '成员', variant: 'secondary', icon: UserRound },
  viewer: { label: '查看者', variant: 'outline', icon: Eye },
}

const MANAGED_ROLES = [
  { value: 'admin', label: '管理员' },
  { value: 'member', label: '成员' },
  { value: 'viewer', label: '查看者' },
]

export default function ProjectMembersPage() {
  const { projectId } = useParams()
  const userRole = useProjectRole()
  const currentUser = useAuthStore((s) => s.user)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserInfo[]>([])
  const [searching, setSearching] = useState(false)
  const [addingUserId, setAddingUserId] = useState<number | null>(null)
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

  // 打开添加面板即加载候选列表（排除已是成员者，默认 10 条，按姓名排序）；
  // 输入关键词后同一接口实时过滤（exclude_project_id 由后端排除成员）
  useEffect(() => {
    if (!showAdd || !projectId) return
    const fetchUsers = async () => {
      setSearching(true)
      try {
        const res = await api.get('/projects/users/search', {
          params: {
            q: searchQuery.trim(),
            exclude_project_id: projectId,
            limit: 10,
          },
        })
        setSearchResults(
          res.data.filter((u: UserInfo) => !members.find((m) => m.user_id === u.id))
        )
      } catch {
        setSearchResults([])
      }
      setSearching(false)
    }
    if (!searchQuery.trim()) {
      fetchUsers()
      return
    }
    const timer = setTimeout(fetchUsers, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, members, showAdd, projectId])

  const handleAddMember = async (userId: number) => {
    if (!projectId) return
    setAddingUserId(userId)
    try {
      await api.post(`/projects/${projectId}/members`, { user_id: userId, role: 'member' })
      toast.success('成员添加成功')
      setShowAdd(false)
      setSearchQuery('')
      setSearchResults([])
      loadMembers()
    } catch {
      toast.error('添加失败')
    } finally {
      setAddingUserId(null)
    }
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
      toast.error(errDetail(err, '更新角色失败'))
    } finally {
      setUpdatingUserId(null)
    }
  }

  const canManage = userRole === 'owner' || userRole === 'admin'
  const adminCount = members.filter((member) => member.role === 'owner' || member.role === 'admin').length

  const canManageMember = (member: ProjectMember) => (
    canManage
    && member.role !== 'owner'
    && member.user_id !== currentUser?.id
    && (userRole === 'owner' || member.role !== 'admin')
  )

  const RoleBadge = ({ role }: { role: string }) => {
    const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.member
    const RoleIcon = cfg.icon
    return (
      <Badge variant={cfg.variant} className="gap-1.5 whitespace-nowrap px-2.5 py-1">
        <RoleIcon className="h-3.5 w-3.5" />
        {cfg.label}
      </Badge>
    )
  }

  const RoleSelect = ({ member }: { member: ProjectMember }) => {
    const available = userRole === 'owner'
      ? MANAGED_ROLES
      : MANAGED_ROLES.filter((role) => role.value !== 'admin')
    return (
      <Select
        value={member.role}
        onChange={(e) => handleRoleChange(member, e.target.value)}
        disabled={updatingUserId === member.user_id}
        className="h-8 w-28 border-border bg-card py-1 text-xs sm:w-32"
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
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">项目成员</h1>
            <p className="mt-0.5 text-xs text-muted-foreground tnum">
              {members.length} 位协作者 · {adminCount} 位管理员
            </p>
          </div>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5">
            <UserPlus className="h-4 w-4" />
            添加成员
          </Button>
        )}
      </header>

      {showAdd && (
        <section className="mb-6 overflow-hidden rounded-md border border-border bg-card" aria-label="添加项目成员">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索用户名或昵称..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="h-9 border-0 bg-muted/60 pl-9 shadow-none focus-visible:ring-1"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              onClick={() => { setShowAdd(false); setSearchQuery(''); setSearchResults([]) }}
              aria-label="关闭添加成员"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {searching && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {searchQuery.trim() ? '搜索中...' : '加载候选用户...'}
              </p>
            )}
            {!searching && searchResults.map((user) => (
              <div
                key={user.id}
                className="flex min-h-14 items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5 last:border-b-0 hover:bg-muted/35"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={user.display_name || user.username} src={user.avatar_url} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{user.display_name || user.username}</p>
                    <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 flex-none"
                  onClick={() => handleAddMember(user.id)}
                  disabled={addingUserId !== null}
                  loading={addingUserId === user.id}
                  aria-label={`添加成员 ${user.username}`}
                  title="添加成员"
                >
                  <Plus className={cn('h-4 w-4', addingUserId === user.id && 'hidden')} />
                </Button>
              </div>
            ))}
            {!searching && searchResults.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {searchQuery ? '未找到用户' : '暂无可添加的用户'}
              </p>
            )}
          </div>
        </section>
      )}

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="暂无成员"
          description="添加成员到项目协作"
        />
      ) : (
        <section className="overflow-hidden border-y border-border" aria-label="项目成员名册">
          <div className="hidden grid-cols-[minmax(0,1fr)_9rem_2.5rem] items-center gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[10px] font-semibold text-muted-foreground sm:grid">
            <span>成员</span>
            <span>项目角色</span>
            <span className="sr-only">操作</span>
          </div>
          {members.map((m) => (
            <div
              key={m.id}
              className="grid min-h-[68px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border/75 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/25 sm:grid-cols-[minmax(0,1fr)_9rem_2.5rem]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={m.display_name || m.username} src={m.avatar_url} size="md" />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{m.display_name || m.username}</p>
                    {m.user_id === currentUser?.id && (
                      <span className="flex-none rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">你</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">@{m.username}</p>
                </div>
              </div>

              <div className="flex justify-end sm:justify-start">
                {canManageMember(m) ? <RoleSelect member={m} /> : <RoleBadge role={m.role} />}
              </div>

              <div className="flex w-8 justify-end">
                {canManageMember(m) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    onClick={() => handleRemoveMember(m.user_id, m.username)}
                    aria-label={`移除成员 ${m.username}`}
                    title="移除成员"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
