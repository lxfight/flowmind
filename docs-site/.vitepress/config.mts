import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'FlowMind',
  description: 'LLM 驱动的智能项目管理平台 —— 看板协作 · RAG 知识库 · AI 助手',
  base: '/flowmind/',

  head: [
    ['link', { rel: 'icon', href: '/flowmind/favicon.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'FlowMind',

    nav: [
      { text: '指南', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: '功能', link: '/features/kanban', activeMatch: '/features/' },
      { text: '架构', link: '/architecture/', activeMatch: '/architecture/' },
      {
        text: 'GitHub',
        link: 'https://github.com/lxfight/flowmind',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '介绍', link: '/guide/introduction' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '配置说明', link: '/guide/configuration' },
            { text: '部署', link: '/guide/deployment' },
          ],
        },
      ],
      '/features/': [
        {
          text: '功能',
          items: [
            { text: '智能看板', link: '/features/kanban' },
            { text: 'AI 助手', link: '/features/ai-assistant' },
            { text: 'RAG 知识库', link: '/features/knowledge' },
            { text: '跨项目助手', link: '/features/cross-project' },
            { text: '系统管理', link: '/features/admin' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '架构',
          items: [{ text: '技术栈与架构', link: '/architecture/' }],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/lxfight/flowmind' },
    ],

    footer: {
      message: '基于 MIT 许可证发布',
      copyright: 'Copyright © 2026 lxfight',
    },

    editLink: {
      pattern: 'https://github.com/lxfight/flowmind/edit/main/docs-site/:path',
      text: '在 GitHub 上编辑此页',
    },

    outline: { label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
  },
})
