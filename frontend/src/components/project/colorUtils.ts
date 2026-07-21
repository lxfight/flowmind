/** Hex color helpers shared by the project color picker and its tests. */

/** 归一化为 #rrggbb；非法输入回退默认色 */
export function normalizeHex(hex: string): string {
  const v = hex.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1]
    const g = v[2]
    const b = v[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return '#6366f1'
}

/** 主色按 ratio 混入白色，生成浅色背景衍生色 */
export function tintWithWhite(hex: string, ratio = 0.88): string {
  const n = normalizeHex(hex)
  const channel = (i: number) => parseInt(n.slice(i, i + 2), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * ratio)
  const to2 = (v: number) => v.toString(16).padStart(2, '0')
  return `#${to2(mix(channel(1)))}${to2(mix(channel(3)))}${to2(mix(channel(5)))}`
}
