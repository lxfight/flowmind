# 技术栈与架构

## 技术栈

| 层 | 技术 |
|----|------|
| **前端** | React 19 · TypeScript · Vite 6 · TailwindCSS · Zustand · @dnd-kit · framer-motion |
| **后端** | FastAPI · SQLAlchemy (async) · Alembic · LangGraph · OpenAI SDK |
| **数据** | PostgreSQL 17 + pgvector（SQLite 可降级开发） |
| **检索** | 向量余弦相似度 + CJK bigram 关键词打分，RRF (k=60) 融合 |
| **工程** | ruff · pytest (160+) · Vitest · GitHub Actions CI |

## 架构说明

系统分为前端、后端、数据、外部服务四层，数据流向如下：

```text
┌──────────────────────────────────────────────────────────┐
│ 前端  React 19 + Vite · Tailwind · Zustand                │
│        │  REST / SSE                                     │
└────────┼─────────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────┐
│ 后端  FastAPI                                            │
│        ├── LangGraph Agent ── 工具调用 · SSE 流式输出      │
│        └── RAG 混合检索 ── 向量 + 关键词，RRF 融合          │
└────────┬───────────────────────────────┬─────────────────┘
         ▼                               ▼
┌──────────────────────┐      ┌────────────────────────────┐
│ 数据  PostgreSQL      │      │ 外部服务                    │
│       + pgvector     │      │  · LLM API（OpenAI 兼容）   │
│  业务数据 + 向量索引   │      │  · Embedding API（可独立配置）│
└──────────────────────┘      └────────────────────────────┘
```

- **前端 ↔ 后端**：看板等业务操作走 REST；AI 对话走 SSE 长连接，token 与工具事件逐帧推送
- **Agent**：LangGraph 编排的工具调用循环——模型决策、调用工具（任务读写 / 知识库检索 / 追问用户）、流式回写
- **RAG**：向量召回与关键词召回并行，RRF 融合后过相似度阈值；无命中则明确告知，不编造
- **运行时配置**：LLM / Embedding / 检索参数由配置服务统一管理，超管在线修改即时生效，无需重启

## 项目结构

```text
FlowMind/
├── docker-compose.yml          # 全服务编排
├── backend/
│   └── app/
│       ├── api/                # REST / SSE 路由
│       ├── core/               # 配置 / 数据库 / 安全
│       ├── models/             # SQLAlchemy 模型
│       └── services/           # Agent / RAG / 运行时配置
├── frontend/
│   └── src/
│       ├── components/         # 看板 / 知识库 / LLM 聊天组件
│       ├── pages/              # 页面
│       └── stores/             # Zustand 状态
├── docs/plans/                 # 设计方案文档
└── docs-site/                  # 本文档站（VitePress）
```
