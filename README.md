<div align="center">

# 🧠 FlowMind

**LLM 驱动的智能项目管理平台**

看板协作 · RAG 知识库 · AI 助手 —— 让 AI 真正读懂你的项目

[![CI](https://github.com/lxfight/flowmind/actions/workflows/ci.yml/badge.svg)](https://github.com/lxfight/flowmind/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![pgvector](https://img.shields.io/badge/pgvector-PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)

</div>

---

## ✨ 功能特性

<table>
<tr>
<td width="50%">

### 📋 智能看板
- 拖拽式任务卡片，自定义状态列
- 子任务拆分、优先级、截止日期
- **列内筛选与排序**（关键词 / 负责人 / 优先级 / 时间）
- 评论 @ 提及，实时通知

### 🤖 AI 助手
- 自然语言创建、调整看板任务
- **SSE 流式对话**，工具调用过程实时可见
- 对话中 `@` 项目成员并触发通知
- 会话按 **用户 × 项目** 严格隔离

</td>
<td width="50%">

### 📚 RAG 知识库
- 上传 PDF / DOCX / PPTX / Markdown 等，自动解析索引
- **混合检索**：向量语义 + 关键词 RRF 融合
- 相似度阈值过滤，无命中不编造
- AI 可**通读完整文档**，据此拆解详细任务

### 🌐 跨项目协作
- 「我的项目」页**跨项目助手**：一次提问，检索全部参与的项目
- 检索结果标注来源项目，写操作自动追问目标
- 项目成员候选列表，一键添加

</td>
</tr>
<tr>
<td width="50%">

### ⚙️ 超管配置中心
- 在线调整 LLM / Embedding 配置，**免重启即时生效**
- LLM 与 Embedding 可配置**独立的 URL 和 Key**
- 一键**连通性测试**，API 异常快速排障
- 密钥脱敏展示，来源可追溯（环境变量 / 运行时覆盖）

</td>
<td width="50%">

### 🔐 权限与安全
- 超级管理员 + 注册审批 + 项目角色分层
- JWT 鉴权、bcrypt 加密、登录防暴力破解
- 越权访问返回 404，不泄露资源存在性
- 亮色 / 暗色主题切换

</td>
</tr>
</table>

---

## 🏗️ 架构一览

```mermaid
graph LR
    subgraph 前端
        UI[React 19 + Vite<br/>Tailwind + Zustand]
    end
    subgraph 后端
        API[FastAPI]
        AGENT[LangGraph Agent<br/>工具调用 · SSE 流式]
        RAG[RAG 混合检索<br/>向量 + 关键词 RRF]
    end
    subgraph 数据
        PG[(PostgreSQL<br/>+ pgvector)]
    end
    subgraph 外部服务
        LLM[LLM API<br/>OpenAI 兼容]
        EMB[Embedding API<br/>可独立配置]
    end
    UI <-->|REST / SSE| API
    API --> AGENT
    API --> RAG
    AGENT --> LLM
    RAG --> EMB
    AGENT --> PG
    RAG --> PG
```

---

## 🚀 快速开始

### Docker Compose（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/lxfight/flowmind.git
cd flowmind

# 2.（可选）配置环境变量
cp .env.example .env   # 编辑 LLM_API_KEY 等

# 3. 启动全部服务
docker compose up -d

# 4. 查看日志获取初始管理员密码
docker compose logs backend
```

访问 **http://localhost** 即可使用。首次启动自动创建管理员账号并完成数据库迁移。

> 💡 没有 LLM Key 也能跑：知识库自动降级为关键词检索，其余功能不受影响。登录后可在 **系统配置** 页在线配置 Key 并测试连通性。

### 本地开发

<details>
<summary><b>后端</b>（Python 3.12+，推荐 uv）</summary>

```bash
docker compose up -d postgres   # PostgreSQL + pgvector
cd backend
uv sync && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```
</details>

<details>
<summary><b>前端</b>（Node 20+）</summary>

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```
</details>

<details>
<summary><b>无 Docker 的 SQLite 模式</b></summary>

```env
# .env 中修改
DATABASE_URL=sqlite+aiosqlite:///./flowmind.db
```

SQLite 模式下向量检索降级为关键词检索，其余功能不受影响。
</details>

---

## 🔧 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | 数据库连接串 | `postgresql+asyncpg://flowmind:flowmind_secret@localhost:5432/flowmind` |
| `JWT_SECRET` | JWT 签名密钥（生产必设） | 自动生成 |
| `FLOWMIND_ADMIN_PASSWORD` | 初始管理员密码 | 随机生成（见启动日志） |
| `LLM_API_KEY` | LLM 对话 API 密钥 | — |
| `LLM_BASE_URL` | LLM API 地址（OpenAI 兼容） | — |
| `LLM_MODEL` | 对话模型 | `gpt-4o-mini` |
| `EMBEDDING_API_KEY` | Embedding 独立密钥（留空回退 LLM Key） | — |
| `EMBEDDING_BASE_URL` | Embedding 独立地址（留空回退 LLM URL） | — |
| `LLM_EMBEDDING_MODEL` | 向量模型 | `text-embedding-3-small` |
| `LLM_EMBEDDING_DIM` | 向量维度（需与模型输出一致） | `1536` |
| `KNOWLEDGE_MAX_BYTES` | 知识库单文件上限 | `26214400` (25MB) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token 有效期 | `1440` |

> 以上 LLM / Embedding / 检索参数均可在超管的 **系统配置** 页在线修改，运行时覆盖、即时生效。

---

## 🧰 技术栈

| 层 | 技术 |
|----|------|
| **前端** | React 19 · TypeScript · Vite 6 · TailwindCSS · Zustand · @dnd-kit · framer-motion |
| **后端** | FastAPI · SQLAlchemy (async) · Alembic · LangGraph · OpenAI SDK |
| **数据** | PostgreSQL 17 + pgvector（SQLite 可降级开发） |
| **检索** | 向量余弦相似度 + CJK bigram 关键词打分，RRF (k=60) 融合 |
| **工程** | ruff · pytest (160+) · Vitest · GitHub Actions CI |

## 📁 项目结构

```
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
└── docs/plans/                 # 设计方案文档
```

---

<div align="center">

**[MIT License](LICENSE)** · Made with ❤️ by [lxfight](https://github.com/lxfight)

</div>
