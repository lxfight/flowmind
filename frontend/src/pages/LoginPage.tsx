import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'
import axios from 'axios'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(username, password)
      navigate('/')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status
        const detail = err.response?.data?.detail || ''
        if (status === 403) {
          if (detail.includes('审批')) toast.error('账号尚未通过审批，请等待管理员审批')
          else if (detail.includes('禁用')) toast.error('账号已被禁用，请联系管理员')
          else toast.error('登录失败，账号受限')
        } else if (status === 429) {
          toast.error('登录尝试过于频繁，请稍后再试')
        } else {
          toast.error('登录失败，请检查用户名和密码')
        }
      } else {
        toast.error('登录失败，请检查用户名和密码')
      }
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold tracking-tight text-foreground">
            Flow<span className="text-primary">M</span>ind
          </CardTitle>
          <div className="mx-auto mt-2 h-0.5 w-10 rounded-full bg-primary" aria-hidden="true" />
          <CardDescription className="pt-2">登录到智能任务管理系统</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">用户名</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">密码</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading} loading={loading}>
              登录
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground mt-6">
            还没有账号？{' '}
            <Link to="/register" className="text-primary hover:underline">
              注册
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
