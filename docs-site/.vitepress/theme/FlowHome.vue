<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import {
  ArrowDownRight,
  ArrowRight,
  BellRing,
  Blocks,
  Bot,
  Braces,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Github,
  LayoutDashboard,
  LibraryBig,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-vue-next'

const hero = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const capabilities = [
  {
    icon: LayoutDashboard,
    index: '01',
    title: '看板协作',
    description: '让任务、负责人、截止日期与状态流转保持在同一工作视野。',
  },
  {
    icon: Bot,
    index: '02',
    title: '项目助手',
    description: '使用自然语言检索项目、操作任务，并保留完整工具调用轨迹。',
  },
  {
    icon: LibraryBig,
    index: '03',
    title: '知识工作区',
    description: '从真实项目资料中检索、通读与生成，拒绝脱离上下文的回答。',
  },
  {
    icon: Radio,
    index: '04',
    title: '实时信号',
    description: '通知直达任务与评论，让项目变化从消息流直接回到执行现场。',
  },
  {
    icon: ShieldCheck,
    index: '05',
    title: '权限边界',
    description: '用户审批、项目角色与资源隔离共同构成清晰的数据边界。',
  },
  {
    icon: Workflow,
    index: '06',
    title: '可靠交付',
    description: '从自动备份到健康验证与中断恢复，版本升级全过程可追踪。',
  },
]

const releaseSignals = [
  {
    icon: BellRing,
    label: '通知深链',
    detail: '任务事件可直达目标看板与任务详情',
  },
  {
    icon: Clock3,
    label: '活动时间线',
    detail: '横向浏览、虚拟渲染、自动定位最新事件',
  },
  {
    icon: DatabaseZap,
    label: '报告可靠性',
    detail: '超时、重试、状态隔离与 Markdown 渲染修复',
  },
  {
    icon: RotateCcw,
    label: '更新恢复',
    detail: '备份空间校验、恢复检查点与健康验证',
  },
]

function trackPointer(event: PointerEvent) {
  if (!hero.value) return
  const bounds = hero.value.getBoundingClientRect()
  const x = event.clientX - bounds.left
  const y = event.clientY - bounds.top
  const shiftX = ((x / bounds.width) - 0.5) * -18
  const shiftY = ((y / bounds.height) - 0.5) * -12
  hero.value.style.setProperty('--pointer-x', `${x}px`)
  hero.value.style.setProperty('--pointer-y', `${y}px`)
  hero.value.style.setProperty('--image-x', `${shiftX}px`)
  hero.value.style.setProperty('--image-y', `${shiftY}px`)
}

function resetPointer() {
  if (!hero.value) return
  hero.value.style.setProperty('--pointer-x', '76%')
  hero.value.style.setProperty('--pointer-y', '42%')
  hero.value.style.setProperty('--image-x', '0px')
  hero.value.style.setProperty('--image-y', '0px')
}

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible')
      })
    },
    { threshold: 0.16 },
  )
  document.querySelectorAll('[data-reveal]').forEach((element) => observer?.observe(element))
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <main class="flow-home">
    <section
      ref="hero"
      class="flow-hero"
      @pointermove="trackPointer"
      @pointerleave="resetPointer"
    >
      <img
        class="flow-hero__image"
        :src="withBase('/images/02-dashboard.png')"
        alt="FlowMind 项目总览界面"
      >
      <div class="flow-hero__veil" aria-hidden="true" />
      <div class="flow-hero__cursor" aria-hidden="true" />

      <div class="flow-hero__content">
        <div class="flow-hero__meta" data-reveal>
          <span class="flow-hero__status"><span /> VERSION 0.2.2</span>
          <span>PROJECT INTELLIGENCE SYSTEM</span>
        </div>

        <div class="flow-hero__copy">
          <p class="flow-kicker" data-reveal>LLM 驱动的项目协作系统</p>
          <h1 data-reveal>Flow<span>Mind</span></h1>
          <p class="flow-hero__statement" data-reveal>
            把看板、项目知识与 AI 行动能力放进同一个实时工作现场。
          </p>
          <div class="flow-hero__actions" data-reveal>
            <a class="flow-button flow-button--primary" :href="withBase('/guide/getting-started')">
              开始部署
              <ArrowRight :size="18" :stroke-width="1.8" />
            </a>
            <a
              class="flow-button flow-button--ghost"
              href="https://github.com/lxfight/flowmind"
              target="_blank"
              rel="noreferrer"
            >
              <Github :size="18" :stroke-width="1.8" />
              查看源码
            </a>
          </div>
        </div>

        <a class="flow-hero__scroll" href="#release" aria-label="浏览版本更新">
          <span>EXPLORE THE RELEASE</span>
          <ArrowDownRight :size="20" :stroke-width="1.6" />
        </a>
      </div>
    </section>

    <section class="flow-marquee" aria-label="核心能力">
      <div class="flow-marquee__track">
        <span>Kanban orchestration</span><Blocks :size="17" />
        <span>Context-aware assistant</span><Braces :size="17" />
        <span>Hybrid retrieval</span><LibraryBig :size="17" />
        <span>Recoverable delivery</span><RotateCcw :size="17" />
        <span>Kanban orchestration</span><Blocks :size="17" />
        <span>Context-aware assistant</span><Braces :size="17" />
        <span>Hybrid retrieval</span><LibraryBig :size="17" />
        <span>Recoverable delivery</span><RotateCcw :size="17" />
      </div>
    </section>

    <section id="release" class="flow-release flow-section">
      <div class="flow-release__number" data-reveal aria-hidden="true">02.2</div>
      <div class="flow-release__content">
        <p class="flow-kicker flow-kicker--dark" data-reveal>Latest release / July 2026</p>
        <h2 data-reveal>一次面向工作流完整性的系统升级。</h2>
        <p class="flow-release__intro" data-reveal>
          v0.2.2 不只更新视觉语言。它让通知准确落到任务，让长时间线保持流畅，让报告生成具备明确的失败边界，也让生产更新在中断后能够恢复。
        </p>

        <div class="flow-release__signals">
          <article v-for="signal in releaseSignals" :key="signal.label" data-reveal>
            <component :is="signal.icon" :size="21" :stroke-width="1.6" />
            <div>
              <h3>{{ signal.label }}</h3>
              <p>{{ signal.detail }}</p>
            </div>
          </article>
        </div>

        <a class="flow-text-link" :href="withBase('/guide/releases')" data-reveal>
          阅读完整版本变化
          <ArrowRight :size="17" />
        </a>
      </div>
    </section>

    <section class="flow-workspace flow-section">
      <div class="flow-section__head" data-reveal>
        <p class="flow-kicker flow-kicker--dark">One workspace / Shared context</p>
        <h2>项目发生的一切，<br>都在同一个上下文里。</h2>
      </div>

      <div class="flow-workspace__stage" data-reveal>
        <figure class="flow-workspace__primary">
          <img :src="withBase('/images/03-kanban.png')" alt="FlowMind 智能看板">
          <figcaption><span>01</span> 智能看板</figcaption>
        </figure>
        <figure class="flow-workspace__secondary">
          <img :src="withBase('/images/04-chat-panel.png')" alt="FlowMind AI 助手面板">
          <figcaption><span>02</span> 项目助手</figcaption>
        </figure>
        <div class="flow-workspace__note">
          <Sparkles :size="24" :stroke-width="1.5" />
          <p>AI 不在工作流之外回答问题。它读取项目上下文，也在授权范围内参与执行。</p>
        </div>
      </div>
    </section>

    <section class="flow-capabilities flow-section">
      <div class="flow-section__head flow-section__head--split" data-reveal>
        <div>
          <p class="flow-kicker flow-kicker--dark">System capabilities</p>
          <h2>从信号到行动。</h2>
        </div>
        <p>面向真实团队协作，而不是孤立的功能集合。</p>
      </div>

      <div class="flow-capabilities__grid">
        <article v-for="capability in capabilities" :key="capability.index" data-reveal>
          <div class="flow-capabilities__topline">
            <span>{{ capability.index }}</span>
            <component :is="capability.icon" :size="24" :stroke-width="1.5" />
          </div>
          <h3>{{ capability.title }}</h3>
          <p>{{ capability.description }}</p>
        </article>
      </div>
    </section>

    <section class="flow-knowledge flow-section">
      <div class="flow-knowledge__visual" data-reveal>
        <img :src="withBase('/images/05-knowledge.png')" alt="FlowMind RAG 知识库">
        <div class="flow-knowledge__metric">
          <CheckCircle2 :size="18" />
          <span>向量语义 + 关键词 RRF</span>
        </div>
      </div>
      <div class="flow-knowledge__copy" data-reveal>
        <p class="flow-kicker flow-kicker--dark">Grounded intelligence</p>
        <h2>让答案扎根于项目事实。</h2>
        <p>文档自动解析、分块与索引。检索没有命中时，系统明确说明边界，而不是补全一个看似合理的答案。</p>
        <a class="flow-text-link" :href="withBase('/features/knowledge')">
          探索知识工作区
          <ArrowRight :size="17" />
        </a>
      </div>
    </section>

    <section class="flow-closing">
      <div>
        <p class="flow-kicker">Open source / Ready to deploy</p>
        <h2>把复杂留给系统，<br>把注意力还给团队。</h2>
      </div>
      <a class="flow-button flow-button--light" :href="withBase('/guide/getting-started')">
        部署 FlowMind
        <ArrowRight :size="19" />
      </a>
    </section>
  </main>
</template>
