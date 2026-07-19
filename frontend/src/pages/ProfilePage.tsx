import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { User, Mail, Lock, Save, Key } from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'

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

  useEffect(() => {
    if (!user) return
    setDisplayName(user.display_name || '')
    setEmail(user.email || '')
  }, [user?.id, user?.display_name, user?.email])

  const handleSaveProfile = async () => {
    if (!displayName.trim()) return
    setSavingProfile(true)
    try {
      await api.put('/auth/profile', { display_name: displayName.trim(), email: email.trim() })
      await loadUser()
      toast.success('资料已更新')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '保存失败')
    } finally {
      setSavingProfile(false)
    }
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
    } finally {
      setChangingPassword(false)
    }
  }

  if (!user) return null

  return (
    <div className="page-container h-full overflow-y-auto">
      <div className="mx-auto max-w-xl space-y-6">
        <h2 className="page-title">个人资料设置</h2>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-1.5">
              <User className="h-4 w-4 text-muted-foreground" />
              基本信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">用户名（不可修改）</label>
              <Input value={user.username} disabled className="bg-muted cursor-not-allowed" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">昵称</label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="输入昵称"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" /> 邮箱
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="输入邮箱"
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleSaveProfile}
                disabled={savingProfile || !displayName.trim()}
                loading={savingProfile}
                className="gap-1.5"
              >
                <Save className="h-4 w-4" />
                保存修改
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-muted-foreground" />
              修改密码
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">原密码</label>
              <Input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="输入原密码"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">新密码</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少6位"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">确认新密码</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleChangePassword}
                disabled={changingPassword || !oldPassword || !newPassword || !confirmPassword}
                loading={changingPassword}
                className="gap-1.5"
              >
                <Key className="h-4 w-4" />
                修改密码
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
