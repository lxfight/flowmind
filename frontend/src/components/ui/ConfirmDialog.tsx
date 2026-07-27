import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CircleHelp, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from './Button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './Dialog'
import { cn } from '../../utils/cn'
import { subscribeConfirm, type ConfirmRequest } from './confirmAction'

const iconMap = {
  question: CircleHelp,
  warning: AlertTriangle,
  delete: Trash2,
  reset: RotateCcw,
}

export function ConfirmDialogHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const queue = useRef<ConfirmRequest[]>([])

  useEffect(() => {
    const pendingQueue = queue.current
    const listener = (nextRequest: ConfirmRequest) => {
      pendingQueue.push(nextRequest)
      setRequest((current) => current ?? nextRequest)
    }
    const unsubscribe = subscribeConfirm(listener)
    return () => {
      unsubscribe()
      pendingQueue.splice(0).forEach((pending) => pending.resolve(false))
    }
  }, [])

  const finish = useCallback((confirmed: boolean) => {
    const active = queue.current.shift()
    active?.resolve(confirmed)
    setRequest(queue.current[0] ?? null)
  }, [])

  if (!request) return null

  const { options } = request
  const tone = options.tone ?? 'default'
  const Icon = iconMap[options.icon ?? (tone === 'danger' ? 'delete' : tone === 'warning' ? 'warning' : 'question')]

  return (
    <Dialog open onClose={() => finish(false)} className="max-w-md overflow-hidden" ariaLabel={options.title}>
      <DialogHeader className="relative overflow-hidden px-6 pb-6 pt-6">
        <span
          className={cn(
            'absolute inset-y-0 left-0 w-1',
            tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-primary'
          )}
          aria-hidden="true"
        />
        <div className="flex items-start gap-4">
          <span
            className={cn(
              'flex h-11 w-11 flex-none items-center justify-center rounded-[8px]',
              tone === 'danger'
                ? 'bg-danger/10 text-danger'
                : tone === 'warning'
                  ? 'bg-warning/10 text-warning'
                  : 'bg-primary/10 text-primary'
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="mb-1 text-[10px] font-semibold text-muted-foreground">确认操作</p>
            <DialogTitle className="text-xl leading-tight">{options.title}</DialogTitle>
            <DialogDescription className="mt-2">{options.description}</DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <DialogFooter className="px-6 pb-6 pt-4">
        <Button variant="ghost" onClick={() => finish(false)}>
          {options.cancelLabel ?? '取消'}
        </Button>
        <Button
          variant={tone === 'danger' ? 'destructive' : 'default'}
          onClick={() => finish(true)}
        >
          {options.confirmLabel ?? '确认'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
