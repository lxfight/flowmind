import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { Camera, Key, Link2, Lock, Mail, Save, User, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import api, { errDetail } from '../utils/api'
import toast from 'react-hot-toast'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Avatar } from '../components/ui/Avatar'

function ProfileSection({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-5 border-t border-border py-7 last:border-b md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10">
      <div>
        <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}

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

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form fields when the user object changes
    setDisplayName(user.display_name || '')
    setEmail(user.email || '')
    setAvatarUrl(user.avatar_url || '')
  }, [user])

  const handleSaveProfile = async () => {
    if (!displayName.trim()) return
    setSavingProfile(true)
    try {
      await api.put('/auth/profile', { display_name: displayName.trim(), email: email.trim(), avatar_url: avatarUrl.trim() || null })
      await loadUser()
      toast.success('资料已更新')
    } catch (err: any) {
      toast.error(errDetail(err, '保存失败'))
    } finally {
      setSavingProfile(false)
    }
  }

  const handleAvatarFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('请上传图片文件')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('头像大小不能超过 2MB')
      return
    }
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post('/auth/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setAvatarUrl(res.data.avatar_url)
      await loadUser()
      toast.success('头像已上传')
    } catch (err: any) {
      toast.error(errDetail(err, '头像上传失败'))
    } finally {
      setUploadingAvatar(false)
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
      toast.error(errDetail(err, '密码修改失败'))
    } finally {
      setChangingPassword(false)
    }
  }

  if (!user) return null

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="个人资料" description="管理头像、身份信息和账号安全。" />

      <ProfileSection icon={Camera} title="头像" description="用于项目成员和任务协作中的身份识别。">
          <div className="flex items-center gap-4">
            <Avatar name={user.display_name || user.username} src={avatarUrl || user.avatar_url} size="lg" className="h-16 w-16" />
            <div className="flex-1 space-y-2">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleAvatarFile(file)
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  loading={uploadingAvatar}
                  className="gap-1.5"
                >
                  <Camera className="h-4 w-4" />
                  上传头像
                </Button>
                {avatarUrl && (
                  <Button variant="ghost" size="sm" onClick={() => setAvatarUrl('')}>
                    移除
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="或使用图片 URL"
                  className="text-sm"
                />
              </div>
            </div>
          </div>
      </ProfileSection>

      <ProfileSection icon={User} title="身份信息" description="昵称和邮箱会展示在项目协作界面。">
            <div className="grid gap-4 sm:grid-cols-2">
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
      </ProfileSection>

      <ProfileSection icon={Lock} title="账号安全" description="更新密码后，现有登录状态保持不变。">
            <div className="grid gap-4 sm:grid-cols-3">
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
      </ProfileSection>
    </div>
  )
}
