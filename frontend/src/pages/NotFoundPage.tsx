import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="p-10">
          <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
          <p className="text-xl font-semibold text-foreground mb-2">页面未找到</p>
          <p className="text-sm text-muted-foreground mb-6">
            你访问的页面不存在或已被移除。
          </p>
          <Button onClick={() => navigate('/')}>返回首页</Button>
        </CardContent>
      </Card>
    </div>
  )
}
