# FlowMind

LLM 智能任务管理系统 — 基于看板的现代化项目管理工具，集成 AI 辅助任务生成与知识库管理。

## 功能特性

- **看板管理** — 拖拽式任务卡片，自定义列状态，子任务拆分，优先级标记
- **AI 辅助** — 自然语言描述自动生成任务，RAG 知识库问答，项目报告自动生成
- **知识库** — 上传文档（PDF/DOCX/PPTX/HTML/图片/Markdown），自动解析索引，支持语义检索
- **权限系统** — 超级管理员、注册审批、项目创建权限、项目角色（owner/admin/member/viewer）分层控制
- **团队协作** — 项目成员管理，任务指派，活动日志时间线
- **数据看板** — 项目统计、进度条、逾期提醒
- **暗色模式** — 支持亮色/暗色主题切换
- **安全防护** — JWT 鉴权、bcrypt 密码加密、登录防暴力破解

## 快速开始

### 使用 Docker Compose（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/lxfight/flowmind.git
cd flowmind

# 2. （可选）编辑环境变量
# cp .env.example .env
# 编辑 .env 设置 LLM_API_KEY 等

# 3. 启动所有服务
docker compose up -d

# 4. 查看启动日志（获取管理员密码）
docker compose logs backend

# 访问 http://localhost
```

首次启动会自动创建默认管理员账号，密码打印在启动日志中。

### 本地开发

#### 数据库

```bash
# 启动 PostgreSQL + pgvector
docker compose up -d postgres
```

#### 后端

```bash
cd backend
# 安装依赖（推荐使用 uv）
uv sync
source .venv/bin/activate
# 启动开发服务器
uvicorn app.main:app --reload --port 8000
```

#### 前端

```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:5173
```

#### 使用 SQLite 开发（无 Docker）

修改 `.env` 使用 SQLite 连接：

```env
# DATABASE_URL=postgresql+asyncpg://flowmind:flowmind_secret@localhost:5432/flowmind
DATABASE_URL=sqlite+aiosqlite:///./flowmind.db
```

SQLite 模式下，RAG 知识库的向量搜索会降级为随机检索，不影响其他功能。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | 数据库连接 | `postgresql+asyncpg://flowmind:flowmind_secret@localhost:5432/flowmind` |
| `JWT_SECRET` | JWT 签名密钥 | 自动生成（生产环境请务必设置） |
| `JWT_ALGORITHM` | JWT 算法 | HS256 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token 过期时间 | 1440 (24h) |
| `FLOWMIND_ADMIN_PASSWORD` | 默认管理员密码 | 随机生成 |
| `LLM_API_KEY` | LLM API 密钥 | - |
| `LLM_BASE_URL` | LLM API 地址 | - |
| `LLM_MODEL` | LLM 模型 | gpt-4o-mini |
| `RATE_LIMIT_LOGIN_MAX` | 登录最大尝试次数 | 5 |
| `RATE_LIMIT_WINDOW` | 速率限制窗口(秒) | 60 |
| `DEBUG` | 调试模式 | false |

## 技术栈

### 后端
- Python 3.12+ / FastAPI
- SQLAlchemy (async) / PostgreSQL + pgvector
- JWT (python-jose) / bcrypt
- OpenAI 兼容 API

### 前端
- React 19 / TypeScript 5.5
- Vite 6 / TailwindCSS 3.4
- @dnd-kit（看板拖拽）
- Zustand 5 / framer-motion
- react-markdown / lucide-react

## 项目结构

```
FlowMind/
├── docker-compose.yml         # 全服务编排
├── .env.example               # 环境变量模板
├── backend/
│   ├── Dockerfile
│   └── app/
│       ├── api/               # API 路由
│       ├── core/              # 配置 / 数据库 / 安全
│       ├── models/            # SQLAlchemy 模型
│       ├── schemas/           # Pydantic 模型
│       └── services/          # LLM / RAG 服务
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
│       ├── components/        # UI 组件
│       ├── pages/             # 页面
│       ├── stores/            # Zustand 状态管理
│       └── utils/             # 工具函数
└── docs/                      # 内部文档（不纳入版本控制）
```

## License

MIT
