import { useEffect, useState } from 'react'
import { Check, FolderKanban, Github, Rocket, Sparkles, User } from 'lucide-react'
import api from '../utils/api'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

const GITHUB_USER = 'lxfight'
const GITHUB_REPO = 'lxfight/flowmind'

interface VersionInfo {
  version: string
  git_sha: string
  build_time: string
}

const HIGHLIGHTS = [
  'AI 对看板的每次改动均可追溯、可撤销',
  '检索设有相似度阈值,查不到如实说明',
  '未配置 LLM 时可正常使用,知识库降级为关键词检索',
]

function AboutSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 border-t border-border py-8 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10">
      <div>
        <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}

export default function AboutPage() {
  const [version, setVersion] = useState<VersionInfo | null>(null)

  useEffect(() => {
    let active = true
    api
      .get<VersionInfo>('/system/version')
      .then((res) => {
        if (active) setVersion(res.data)
      })
      .catch(() => {
        if (active) setVersion(null)
      })
    return () => {
      active = false
    }
  }, [])

  const current = version?.version ?? '0.4.0'

  return (
    <div className="mx-auto w-full max-w-4xl pb-12">
      {/* Hero */}
      <header className="relative mb-8 overflow-hidden border-b border-border px-1 pb-8 pt-1">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-foreground/15" />
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-primary">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                <FolderKanban className="h-3.5 w-3.5" />
              </span>
              FlowMind
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
              LLM 驱动的项目管理平台
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              在看板协作的基础上集成 RAG 知识库与 AI 助手。AI 能检索团队文档、直接操作看板任务,处理过程全程可追溯。
            </p>
          </div>

          <div className="min-w-28 lg:justify-end">
            <p className="text-[10px] font-semibold text-muted-foreground">当前版本</p>
            <p className="tnum mt-1 text-5xl font-semibold leading-none text-foreground" aria-label={`版本 ${current}`}>
              {current}
            </p>
          </div>
        </div>
      </header>

      {/* 项目简介 */}
      <AboutSection icon={Sparkles} title="项目简介" description="定位与核心能力">
        <p className="text-sm leading-6 text-muted-foreground">
          FlowMind 将看板、知识库与 AI 助手整合于同一工作区,解决任务、文档、讨论分散在多个工具间的问题。项目由 lxfight 独立开发,2026 年 7 月启动。
        </p>
        <ul className="space-y-2.5">
          {HIGHLIGHTS.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
                <Check className="h-3 w-3" />
              </span>
              <span className="leading-6">{item}</span>
            </li>
          ))}
        </ul>
      </AboutSection>

      {/* 开发者 */}
      <AboutSection icon={User} title="开发者" description="作者与联系方式">
        <div className="flex flex-wrap items-center gap-4 rounded-[8px] border border-border bg-card p-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <User className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">lxfight</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              作者与维护者,负责项目全部后端、前端与运维工作。
            </p>
          </div>
          <a
            href={`https://github.com/${GITHUB_USER}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>
      </AboutSection>

      {/* 版本与开源 */}
      <AboutSection icon={Rocket} title="版本与开源" description="版本与许可">
        <p className="text-sm leading-6 text-muted-foreground">
          2026 年 7 月发布首个版本,当前为 v0.4.0。核心能力包括:看板协作、AI 助手、RAG 知识库、里程碑与报告、外部通知、在线升级。
        </p>
        <div className="rounded-[8px] border border-border bg-card p-4">
          <p className="text-sm leading-6 text-muted-foreground">
            基于{' '}
            <a
              href={`https://github.com/${GITHUB_REPO}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              MIT 许可证
            </a>{' '}
            开源。问题反馈请前往 GitHub Issues。
          </p>
        </div>
      </AboutSection>
    </div>
  )
}
