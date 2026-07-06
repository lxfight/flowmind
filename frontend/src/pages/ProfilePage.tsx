import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { User, Mail, Lock, Save, Key } from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'

export default function ProfilePage() {
  const { user, loadUser } = useAuthStore()
  const [displayName, setDisplayName] = useState(user?.display_name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [savingProfile, setSavingProfile] = useState(false)

  // Password change
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const handleSaveProfile = async () => {
    if (!displayName.trim()) return
    setSavingProfile(true)
    try {
      await api.put('/auth/profile', { display_name: displayName.trim(), email: email.trim() })
      await loadUser()
      toast.success('资料已更新')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '保存失败')
    }
    setSavingProfile(false)
  }

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      toast.error('请填写所有密码字段')
      return
    }
    if (newPassword.length < 6) {
      toast.error('新密码至少6位')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致')
      return
    }
    setChangingPassword(true)
    try {
      await api.put('/auth/password', { old_password: oldPassword, new_password: newPassword })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('密码修改成功，请牢记新密码')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '密码修改失败')
    }
    setChangingPassword(false)
  }

  if (!user) return null

  return (
    <div className="p-6 h-full overflow-y-auto dark:text-gray-100">
      <div className="max-w-xl mx-auto space-y-6">
        <h2 className="text-xl font-bold">个人资料设置</h2>

        {/* Profile */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 flex items-center gap-1.5">
            <User size={14} /> 基本信息
          </h3>
          <div className="space-y-4">
            {/* Username (readonly) */}
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">用户名（不可修改）</label>
              <input className="input-field bg-gray-100 dark:bg-gray-700 cursor-not-allowed" value={user.username} disabled />
            </div>
            {/* Display name */}
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">昵称</label>
              <input className="input-field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="输入昵称" />
            </div>
            {/* Email */}
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300 flex items-center gap-1"><Mail size={13} /> 邮箱</label>
              <input className="input-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="输入邮箱" />
            </div>
            <div className="flex justify-end">
              <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={handleSaveProfile} disabled={savingProfile}>
                <Save size={14} />
                {savingProfile ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>
        </div>

        {/* Password */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 flex items-center gap-1.5">
            <Lock size={14} /> 修改密码
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">原密码</label>
              <input type="password" className="input-field" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="输入原密码" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">新密码</label>
              <input type="password" className="input-field" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少6位" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">确认新密码</label>
              <input type="password" className="input-field" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" />
            </div>
            <div className="flex justify-end">
              <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={handleChangePassword} disabled={changingPassword}>
                <Key size={14} />
                {changingPassword ? '修改中...' : '修改密码'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
