import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Search, UserPlus, X, Trash2, Users } from 'lucide-react'
import api from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'
import type { ProjectMember, UserInfo } from '../types'

export default function ProjectMembersPage() {
  const { projectId } = useParams()
  const currentUser = useAuthStore((s) => s.user)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserInfo[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)

  const loadMembers = async () => {
    if (!projectId) return
    const res = await api.get(`/projects/${projectId}/members`)
    setMembers(res.data)
  }

  useEffect(() => {
    loadMembers()
  }, [projectId])

  useEffect(() => {
    if (!searchQuery.trim()) {
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

  const currentUserRole = members.find((m) => m.user_id === currentUser?.id)?.role

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      owner: 'bg-yellow-100 text-yellow-700',
      admin: 'bg-blue-100 text-blue-700',
      member: 'bg-gray-100 text-gray-600',
      viewer: 'bg-gray-50 text-gray-400',
    }
    const labels: Record<string, string> = {
      owner: '所有者',
      admin: '管理员',
      member: '成员',
      viewer: '查看者',
    }
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[role] || colors.member}`}>
        {labels[role] || role}
      </span>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">项目成员</h3>
        {(currentUserRole === 'owner' || currentUserRole === 'admin') && (
          <button
            className="btn-primary flex items-center gap-1.5"
            onClick={() => setShowAdd(true)}
          >
            <UserPlus size={16} />
            添加成员
          </button>
        )}
      </div>

      {showAdd && (
        <div className="mb-6 card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Search size={16} className="text-gray-400" />
            <input
              className="input-field flex-1"
              placeholder="搜索用户名或昵称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            <button className="btn-ghost p-1" onClick={() => { setShowAdd(false); setSearchQuery(''); setSearchResults([]) }}>
              <X size={16} />
            </button>
          </div>
          {searching && <p className="text-sm text-gray-400">搜索中...</p>}
          {searchResults.length > 0 && (
            <div className="space-y-1">
              {searchResults.map((u) => (
                <div key={u.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-medium">
                      {(u.display_name || u.username).charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{u.display_name || u.username}</p>
                      <p className="text-xs text-gray-400">@{u.username}</p>
                    </div>
                  </div>
                  <button
                    className="btn-primary text-xs py-1 px-3"
                    onClick={() => handleAddMember(u.id)}
                    disabled={adding}
                  >
                    添加
                  </button>
                </div>
              ))}
            </div>
          )}
          {searchQuery && !searching && searchResults.length === 0 && (
            <p className="text-sm text-gray-400">未找到用户</p>
          )}
        </div>
      )}

      {members.length === 0 ? (
        <div className="card p-12 text-center">
          <Users size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">暂无成员</h3>
          <p className="text-gray-400">添加成员到项目协作</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-medium">
                  {(m.display_name || m.username).charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{m.display_name || m.username}</p>
                    {roleBadge(m.role)}
                  </div>
                  <p className="text-xs text-gray-400">@{m.username}</p>
                </div>
              </div>
              {(currentUserRole === 'owner' || currentUserRole === 'admin') && m.role !== 'owner' && (
                <button
                  className="btn-ghost p-2 text-gray-400 hover:text-red-500"
                  onClick={() => handleRemoveMember(m.user_id, m.username)}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
