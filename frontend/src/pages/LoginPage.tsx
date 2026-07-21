import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'
import axios from 'axios'
import { AuthLayout, FloatInput, Word } from '../components/auth/AuthLayout'

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
    <AuthLayout
      headline={
        <>
          <Word index={0}>让</Word>
          <Word index={1}>任务</Word>{' '}
          <Word index={2} className="text-[#f3702c]">自然</Word>
          <br />
          <Word index={3} className="font-serif italic font-medium text-[#f3702c]">flow</Word>
          <Word index={4}>，</Word>
          <Word index={5}>思绪</Word>
          <Word index={6}>不</Word>
          <Word index={7}>断线</Word>
          <Word index={8}>。</Word>
        </>
      }
      caption="规划、协作、流转 —— 在一个安静的地方，把每一天的工作编织成清晰的脉络。"
    >
      <div className="mb-12">
        <p className="text-[11px] uppercase tracking-[0.24em] text-[#c1480f]">Welcome back</p>
        <h2 className="mt-3 text-[2rem] font-semibold leading-tight tracking-tight text-stone-900">
          登录你的<br />工作台
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-7">
        <FloatInput label="用户名" value={username} onChange={setUsername} autoFocus />
        <FloatInput label="密码" type="password" value={password} onChange={setPassword} />

        <motion.button
          type="submit"
          disabled={loading}
          whileTap={{ scale: 0.985 }}
          className="group relative mt-2 flex w-full items-center justify-between overflow-hidden rounded-full bg-stone-900 py-4 pl-7 pr-2.5 text-[15px] font-medium text-[#f5f2ed] transition-colors duration-300 hover:bg-[#e8490f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>{loading ? '正在登录…' : '登录'}</span>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f2ed] text-stone-900 transition-transform duration-300 group-hover:translate-x-1">
            {loading ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <ArrowRight size={16} />
            )}
          </span>
        </motion.button>
      </form>

      <p className="mt-10 text-sm text-stone-500">
        还没有账号？{' '}
        <Link
          to="/register"
          className="font-medium text-[#c1480f] underline decoration-[#e8490f]/40 underline-offset-4 transition-colors hover:decoration-[#e8490f]"
        >
          注册
        </Link>
      </p>
    </AuthLayout>
  )
}
