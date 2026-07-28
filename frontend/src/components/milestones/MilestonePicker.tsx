import { Check, Flag } from 'lucide-react'
import { cn } from '../../utils/cn'
import type { Milestone } from '../../types'

interface MilestonePickerProps {
  milestones: Milestone[]
  value: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
  emptyLabel?: string
}

export function MilestonePicker({
  milestones,
  value,
  onChange,
  disabled = false,
  emptyLabel = '项目中还没有可用的里程碑',
}: MilestonePickerProps) {
  const active = milestones.filter((milestone) => milestone.status === 'open')
  const selectedArchived = milestones.filter(
    (milestone) => milestone.status !== 'open' && value.includes(milestone.id),
  )
  const options = [...active, ...selectedArchived]

  if (options.length === 0) {
    return <p className="text-xs leading-6 text-muted-foreground">{emptyLabel}</p>
  }

  const toggle = (id: number) => {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="选择里程碑">
      {options.map((milestone) => {
        const selected = value.includes(milestone.id)
        return (
          <button
            key={milestone.id}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => toggle(milestone.id)}
            className={cn(
              'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'border-primary/45 bg-primary/[0.08] text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground',
            )}
          >
            {selected ? <Check className="h-3.5 w-3.5 flex-none" /> : <Flag className="h-3.5 w-3.5 flex-none" />}
            <span className="truncate">{milestone.title}</span>
          </button>
        )
      })}
    </div>
  )
}
