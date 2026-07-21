import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'
import { AuthLayout, FloatInput, Word } from '../components/auth/AuthLayout'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await register(username, email, password)
      toast.success('注册申请已提交，请等待管理员审批后登录')
      navigate('/login')
    } catch {
      toast.error('注册失败')
    }
    setLoading(false)
  }

  return (
    <AuthLayout
      headline={
        <>
          <Word index={0}>新</Word>
          <Word index={1}>的</Word>
          <Word index={2}>起点</Word>
          <Word index={3}>，</Word>
          <br />
          <Word index={4}>从</Word>
          <Word index={5} className="font-serif italic font-medium text-[#f3702c]">one</Word>{' '}
          <Word index={6} className="text-[#f3702c]">任务</Word>
          <Word index={7}>开始</Word>
          <Word index={8}>。</Word>
        </>
      }
      caption="创建一个账号，提交审批后即可进入你的专属工作台，开始组织第一件重要的事。"
    >
      <div className="mb-12">
        <p className="text-[11px] uppercase tracking-[0.24em] text-[#c1480f]">Join FlowMind</p>
        <h2 className="mt-3 text-[2rem] font-semibold leading-tight tracking-tight text-stone-900">
          创建你的<br />账号
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-7">
        <FloatInput label="用户名" value={username} onChange={setUsername} autoFocus />
        <FloatInput label="邮箱" type="email" value={email} onChange={setEmail} />
        <FloatInput label="密码（至少 6 位）" type="password" value={password} onChange={setPassword} minLength={6} />

        <motion.button
          type="submit"
          disabled={loading}
          whileTap={{ scale: 0.985 }}
          className="group relative mt-2 flex w-full items-center justify-between overflow-hidden rounded-full bg-stone-900 py-4 pl-7 pr-2.5 text-[15px] font-medium text-[#f5f2ed] transition-colors duration-300 hover:bg-[#e8490f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>{loading ? '正在提交…' : '注册'}</span>
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
        已有账号？{' '}
        <Link
          to="/login"
          className="font-medium text-[#c1480f] underline decoration-[#e8490f]/40 underline-offset-4 transition-colors hover:decoration-[#e8490f]"
        >
          登录
        </Link>
      </p>
    </AuthLayout>
  )
}
