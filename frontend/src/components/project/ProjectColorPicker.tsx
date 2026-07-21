import { useMemo } from 'react'
import { Plus } from 'lucide-react'
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

  return (
    <div className="space-y-3">
      {/* 实时预览：色条 + 浅色衍生背景 + 色点 + 项目名 */}
      <div className="overflow-hidden rounded-xl border border-border" aria-live="polite">
        <div className="h-1.5 transition-colors" style={{ backgroundColor: normalized }} />
        <div
          className="p-3 transition-colors"
          style={{ backgroundColor: `color-mix(in srgb, ${normalized} 12%, transparent)` }}
        >
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 flex-shrink-0 rounded-full"
              style={{ backgroundColor: normalized }}
            />
            <span className="truncate text-sm font-medium text-foreground">
              {projectName?.trim() || '项目名称'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">项目卡片将以此颜色作为标识色</p>
        </div>
      </div>

      {/* 策划色板 */}
      {COLOR_GROUPS.map((group) => (
        <div key={group.name} className="flex items-center gap-2">
          <span className="w-8 flex-shrink-0 text-xs text-muted-foreground">{group.name}</span>
          <div className="flex flex-wrap gap-1.5">
            {group.colors.map((c) => {
              const selected = normalized === c.value.toLowerCase()
              return (
                <button
                  key={c.value}
                  type="button"
                  title={`${group.name} · ${c.label}`}
                  aria-label={`选择颜色 ${c.label} ${c.value}`}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onChange(c.value)}
                  className={cn(
                    'h-7 w-7 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    selected && 'ring-2 ring-offset-2 ring-foreground scale-110'
                  )}
                  style={{ backgroundColor: c.value }}
                />
              )
            })}
          </div>
        </div>
      ))}

      {/* 自定义色 + 衍生色展示 */}
      <div className="flex items-center gap-2">
        <span className="w-8 flex-shrink-0 text-xs text-muted-foreground">自定义</span>
        <label
          className={cn(
            'relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-border transition-all focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
            isCustom && 'ring-2 ring-offset-2 ring-foreground scale-110'
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
          {isCustom ? (
            <span className="h-full w-full" style={{ backgroundColor: normalized }} />
          ) : (
            <Plus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          )}
        </label>
        {isCustom && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-3.5 w-3.5 rounded border border-border" style={{ backgroundColor: normalized }} />
              主色 {normalized}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3.5 w-3.5 rounded border border-border" style={{ backgroundColor: tint }} />
              浅色背景 {tint}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}
