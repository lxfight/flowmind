import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { ArrowLeft, Compass } from 'lucide-react'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] items-center justify-center overflow-hidden p-4">
      <span className="pointer-events-none absolute text-[15rem] font-semibold leading-none text-foreground/[0.035] tnum sm:text-[24rem]" aria-hidden="true">404</span>
      <div className="relative w-full max-w-lg border-y border-border py-12 text-center">
        <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
          <Compass className="h-5 w-5" />
        </span>
        <p className="tnum text-xs font-semibold text-primary">ERROR 404</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">页面未找到</h1>
        <p className="mx-auto mb-7 mt-3 max-w-sm text-sm leading-6 text-muted-foreground">你访问的页面不存在、已被移动，或当前账号没有访问权限。</p>
        <Button onClick={() => navigate('/')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          返回项目
        </Button>
      </div>
    </div>
  )
}
