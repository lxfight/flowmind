import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

/* ------------------------------------------------------------------ */
/*  FlowField — 认证页左侧视觉面板的生成式流场画布                       */
/*  数百个粒子沿正弦流场游动，拖出烧橙与暖白的长尾，鼠标靠近时产生引力   */
/* ------------------------------------------------------------------ */
export function FlowField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let raf = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const mouse = { x: -9999, y: -9999 }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0d0b09'
      ctx.fillRect(0, 0, w, h)
    }
    resize()
    window.addEventListener('resize', resize)

    const N = 340
    const particles = Array.from({ length: N }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      px: 0,
      py: 0,
      life: Math.random() * 240,
      // 烧橙一族 + 少量暖白，来自品牌色同温层
      hue: Math.random() < 0.82 ? 14 + Math.random() * 16 : 38,
      sat: 60 + Math.random() * 30,
      light: 46 + Math.random() * 18,
      speed: 0.6 + Math.random() * 1.1,
    }))
    particles.forEach((p) => {
      p.px = p.x
      p.py = p.y
    })

    let t = 0
    const field = (x: number, y: number) => {
      const s = 0.0021
      return (
        Math.sin(x * s * 1.7 + t * 0.35) * Math.cos(y * s * 1.3 - t * 0.22) +
        Math.sin((x + y) * s * 0.6 + t * 0.14) * 0.8
      ) * Math.PI
    }

    const tick = () => {
      t += 0.008
      // 拖尾：低透明度覆盖而非清空
      ctx.fillStyle = 'rgba(13, 11, 9, 0.055)'
      ctx.fillRect(0, 0, w, h)
      ctx.lineWidth = 1

      for (const p of particles) {
        const a = field(p.x, p.y)
        let vx = Math.cos(a) * p.speed
        let vy = Math.sin(a) * p.speed

        // 鼠标引力
        const dx = mouse.x - p.x
        const dy = mouse.y - p.y
        const d2 = dx * dx + dy * dy
        if (d2 < 26000) {
          const f = 1 - d2 / 26000
          vx += dx * 0.012 * f
          vy += dy * 0.012 * f
        }

        p.px = p.x
        p.py = p.y
        p.x += vx
        p.y += vy
        p.life -= 1

        if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
          p.x = Math.random() * w
          p.y = Math.random() * h
          p.px = p.x
          p.py = p.y
          p.life = 160 + Math.random() * 160
          continue
        }

        ctx.strokeStyle = `hsla(${p.hue}, ${p.sat}%, ${p.light}%, 0.5)`
        ctx.beginPath()
        ctx.moveTo(p.px, p.py)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
    }
    const onLeave = () => {
      mouse.x = -9999
      mouse.y = -9999
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}

/* ------------------------------------------------------------------ */
/*  逐词遮罩升起 — 每个词置于 overflow-hidden 容器中，0.8s 错峰上浮     */
/* ------------------------------------------------------------------ */
const reveal = {
  hidden: { y: '110%' },
  show: (i: number) => ({
    y: '0%',
    transition: { duration: 0.8, delay: 0.55 + i * 0.09, ease: [0.22, 1, 0.36, 1] as const },
  }),
}

export function Word({ children, index, className = '' }: { children: React.ReactNode; index: number; className?: string }) {
  return (
    <span className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-bottom">
      <motion.span
        className={`inline-block will-change-transform ${className}`}
        custom={index}
        variants={reveal}
        initial="hidden"
        animate="show"
      >
        {children}
      </motion.span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  浮动标签输入框 — 聚焦时下划线扫过 + 标签上浮变色                     */
/* ------------------------------------------------------------------ */
export function FloatInput({
  label,
  type = 'text',
  value,
  onChange,
  autoFocus,
  minLength,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  minLength?: number
}) {
  const [focused, setFocused] = useState(false)
  const active = focused || value.length > 0

  return (
    <label className="group relative block cursor-text pt-5">
      <span
        className={`pointer-events-none absolute left-0 transition-all duration-300 ease-out ${
          active
            ? 'top-0 text-[11px] tracking-[0.14em] text-[#c1480f]'
            : 'top-[1.65rem] text-[15px] text-stone-400'
        }`}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        required
        minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="w-full border-0 border-b border-stone-300 bg-transparent py-2.5 text-[15px] text-stone-900 outline-none transition-colors placeholder-transparent focus:border-stone-300"
      />
      {/* 聚焦时下划线从左扫入 */}
      <span
        className={`absolute bottom-0 left-0 h-[2px] w-full origin-left bg-[#e8490f] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          focused ? 'scale-x-100' : 'scale-x-0'
        }`}
      />
    </label>
  )
}

/* ------------------------------------------------------------------ */
/*  AuthLayout — 左右分屏骨架：左侧流场视觉面板 + 右侧表单区             */
/* ------------------------------------------------------------------ */
export function AuthLayout({
  headline,
  caption,
  children,
}: {
  headline: React.ReactNode
  caption: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-[#f5f2ed] font-sans antialiased">
      {/* ---------------- 左侧 · 视觉面板 ---------------- */}
      <div className="relative hidden w-[52%] overflow-hidden bg-[#0d0b09] lg:block">
        <FlowField />

        {/* 四角留白构图：品牌居左上，宣言居左下 */}
        <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex items-baseline gap-2"
          >
            <span className="text-lg font-semibold tracking-tight text-[#f5f2ed]">
              Flow<span className="text-[#f3702c]">M</span>ind
            </span>
            <span className="text-[11px] uppercase tracking-[0.22em] text-stone-500">
              智能任务管理
            </span>
          </motion.div>

          <div>
            <h1 className="max-w-[12em] text-[clamp(2.6rem,4.2vw,4.4rem)] font-semibold leading-[1.12] tracking-tight text-[#f5f2ed]">
              {headline}
            </h1>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 1.5 }}
              className="mt-8 max-w-sm text-sm leading-relaxed text-stone-400"
            >
              {caption}
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.8 }}
            className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-stone-600"
          >
            <span className="h-px w-10 bg-stone-700" />
            Intelligent Task Orchestration
          </motion.div>
        </div>
      </div>

      {/* ---------------- 右侧 · 表单面板 ---------------- */}
      <div className="relative flex flex-1 items-center justify-center px-6 py-12 sm:px-12">
        {/* 移动端顶部品牌 */}
        <div className="absolute left-6 top-6 lg:hidden">
          <span className="text-lg font-semibold tracking-tight text-stone-900">
            Flow<span className="text-[#e8490f]">M</span>ind
          </span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[380px]"
        >
          {children}
        </motion.div>
      </div>
    </div>
  )
}
