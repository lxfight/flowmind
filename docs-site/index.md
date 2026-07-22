---
layout: home

hero:
  name: FlowMind
  text: LLM 驱动的智能项目管理平台
  tagline: 看板协作 · RAG 知识库 · AI 助手 —— 让 AI 真正读懂你的项目
  image:
    src: /logo.svg
    alt: FlowMind
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/lxfight/flowmind

features:
  - icon: 📋
    title: 智能看板
    details: 拖拽式任务卡片、自定义状态列、子任务拆分，支持列内筛选与排序（关键词 / 负责人 / 优先级 / 时间）。
    link: /features/kanban
    linkText: 了解更多
  - icon: 🤖
    title: AI 助手
    details: 自然语言创建与调整任务，SSE 流式对话，工具调用过程实时可见，对话中 @ 成员并触发通知。
    link: /features/ai-assistant
    linkText: 了解更多
  - icon: 📚
    title: RAG 知识库
    details: 上传 PDF / DOCX / PPTX / Markdown 自动解析索引，向量 + 关键词 RRF 混合检索，无命中不编造。
    link: /features/knowledge
    linkText: 了解更多
  - icon: 🌐
    title: 跨项目助手
    details: 「我的项目」页一次提问检索全部参与的项目，结果标注来源，写操作自动追问目标项目。
    link: /features/cross-project
    linkText: 了解更多
  - icon: ⚙️
    title: 超管配置中心
    details: 在线调整 LLM / Embedding 配置，免重启即时生效，独立 URL 与 Key，一键连通性测试。
    link: /features/admin
    linkText: 了解更多
  - icon: 🔐
    title: 权限与安全
    details: 超级管理员 + 注册审批 + 项目角色分层，JWT 鉴权、bcrypt 加密、越权访问返回 404。
  - icon: 🌗
    title: 亮色 / 暗色主题
    details: 全局主题切换，暗色模式下看板、对话、知识库全适配，长时间使用更舒适。
  - icon: 🐳
    title: 一键部署
    details: Docker Compose 编排全部服务，首次启动自动建库迁移，也支持无 Docker 的 SQLite 开发模式。
    link: /guide/deployment
    linkText: 部署指南
---

<div class="screenshot-gallery">

## 界面一览

### 我的项目 · 项目总览

项目卡片直观展示进度、逾期任务与成员数，一眼掌握所有参与项目的状态。

![我的项目](/images/02-dashboard.png)

### 智能看板 · 筛选与排序

顶部工具栏支持关键词、负责人、优先级筛选，列内可按时间 / 优先级 / 截止日期排序。

![智能看板](/images/03-kanban.png)

### AI 助手 · 流式对话

右下角浮动面板随开随用，工具调用过程实时可见，创建任务、查询进度一句话完成。

![AI 助手面板](/images/04-chat-panel.png)

### 系统配置 · 免重启即时生效

超级管理员在线配置 LLM / Embedding（独立 URL 与 Key），内置连通性测试快速排障。

![系统配置](/images/07-admin-config.png)

### 暗色模式

全局亮 / 暗主题一键切换，看板在暗色下同样清晰。

![暗色模式看板](/images/08-kanban-dark.png)

</div>
