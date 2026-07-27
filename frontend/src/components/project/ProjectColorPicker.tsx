import { useMemo } from 'react'
import { Check, Pipette } from 'lucide-react'
import { cn } from '../../utils/cn'
import { normalizeHex, tintWithWhite } from './colorUtils'

interface ColorGroup {
  name: string
  colors: { value: string; label: string }[]
}

/**
 * 策划色板：沉稳低饱和的和谐色（参考 Linear / Notion 的项目色调），
 * 按色系分组。包含既有默认色 #6366f1 / #3b82f6 / #14b8a6，保证旧项目
 * 颜色在色板中有对应项。
 */
const COLOR_GROUPS: ColorGroup[] = [
  {
    name: '蓝',
    colors: [
      { value: '#3B82F6', label: '明蓝' },
      { value: '#4E6FD9', label: '靛蓝' },
      { value: '#5B8DEF', label: '晴空' },
      { value: '#3D7BC7', label: '深湖' },
    ],
  },
  {
    name: '青',
    colors: [
      { value: '#14B8A6', label: '松青' },
      { value: '#2AA8A0', label: '青瓷' },
      { value: '#4FB3BF', label: '浅青' },
      { value: '#2E8C99', label: '黛青' },
    ],
  },
  {
    name: '绿',
    colors: [
      { value: '#4C9A6C', label: '松绿' },
      { value: '#6B9E5F', label: '苔绿' },
      { value: '#8AAF5C', label: '橄榄' },
      { value: '#3E8E63', label: '墨绿' },
    ],
  },
  {
    name: '紫',
    colors: [
      { value: '#6366F1', label: '鸢尾' },
      { value: '#8B7BD8', label: '堇紫' },
      { value: '#7C5CBF', label: '紫藤' },
      { value: '#A78BDB', label: '藕紫' },
    ],
  },
  {
    name: '粉',
    colors: [
      { value: '#E587A6', label: '樱粉' },
      { value: '#D6698E', label: '蔷薇' },
      { value: '#C74B71', label: '茜红' },
      { value: '#B85C8A', label: '藕荷' },
    ],
  },
  {
    name: '暖色',
    colors: [
      { value: '#E8974A', label: '琥珀' },
      { value: '#D97B4E', label: '赭橙' },
      { value: '#C75B4E', label: '砖红' },
      { value: '#D9A441', label: '藤黄' },
    ],
  },
  {
    name: '中性',
    colors: [
      { value: '#6B7280', label: '石灰' },
      { value: '#5F6B7A', label: '岩灰' },
      { value: '#8A7F72', label: '褐灰' },
      { value: '#4B5563', label: '石墨' },
    ],
  },
]

const ALL_COLORS = COLOR_GROUPS.flatMap((g) => g.colors.map((c) => c.value.toLowerCase()))

interface ProjectColorPickerProps {
  value: string
  onChange: (color: string) => void
  disabled?: boolean
  /** 用于预览卡片的项目名占位 */
  projectName?: string
}

export function ProjectColorPicker({ value, onChange, disabled, projectName }: ProjectColorPickerProps) {
  const normalized = normalizeHex(value)
  const isCustom = !ALL_COLORS.includes(normalized)
  const tint = useMemo(() => tintWithWhite(normalized), [normalized])
  const selectedColor = COLOR_GROUPS.flatMap((group) => group.colors).find(
    (color) => color.value.toLowerCase() === normalized
  )
  const displayName = projectName?.trim() || '未命名项目'
  const projectInitial = displayName.slice(0, 1).toUpperCase()

  return (
    <div className="space-y-5">
      <div
        className="relative overflow-hidden rounded-[8px] border border-border bg-background"
        aria-live="polite"
      >
        <div
          className="absolute inset-y-0 left-0 w-1.5 transition-colors duration-300"
          style={{ backgroundColor: normalized }}
          aria-hidden="true"
        />
        <div
          className="flex min-h-24 items-center gap-4 px-5 py-4 pl-6 transition-colors duration-300"
          style={{ backgroundColor: `color-mix(in srgb, ${normalized} 10%, transparent)` }}
        >
          <span
            className="flex h-12 w-12 flex-none items-center justify-center rounded-[8px] text-lg font-semibold text-white shadow-sm transition-colors duration-300"
            style={{ backgroundColor: normalized }}
            aria-hidden="true"
          >
            {projectInitial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-foreground">{displayName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedColor?.label || '自定义色'}
            </p>
          </div>
          <code className="hidden rounded-md border border-border/80 bg-background/70 px-2 py-1 text-[11px] font-medium uppercase text-muted-foreground sm:block">
            {normalized}
          </code>
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {COLOR_GROUPS.map((group) => (
          <fieldset key={group.name} className="min-w-0">
            <legend className="mb-2 text-[11px] font-medium text-muted-foreground">{group.name}</legend>
            <div className="grid grid-cols-4 gap-2">
              {group.colors.map((color) => {
                const selected = normalized === color.value.toLowerCase()
                return (
                  <button
                    key={color.value}
                    type="button"
                    title={`${group.name} / ${color.label}`}
                    aria-label={`选择颜色 ${color.label} ${color.value}`}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => onChange(color.value)}
                    className={cn(
                      'relative flex h-9 w-full min-w-9 items-center justify-center rounded-[8px] border border-black/5 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40',
                      selected && 'scale-[1.04] ring-2 ring-foreground ring-offset-2'
                    )}
                    style={{ backgroundColor: color.value }}
                  >
                    {selected && (
                      <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} aria-hidden="true" />
                    )}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <label
          className={cn(
            'group relative flex h-10 cursor-pointer items-center gap-2 overflow-hidden rounded-[8px] border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
            disabled && 'pointer-events-none opacity-40',
            isCustom && 'border-foreground/40'
          )}
          title="自定义颜色"
        >
          <input
            type="color"
            value={normalized}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-label="自定义颜色"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <span
            className="h-4 w-4 rounded border border-black/10 transition-colors"
            style={{ backgroundColor: normalized }}
            aria-hidden="true"
          />
          <Pipette className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          自定义
        </label>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="uppercase">{normalized}</span>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <span className="inline-flex items-center gap-1.5">
            <span className="h-4 w-4 rounded border border-border" style={{ backgroundColor: tint }} />
            浅色
          </span>
        </div>
      </div>
    </div>
  )
}
