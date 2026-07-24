# 部署

## Docker Compose 部署

仓库根目录的 `docker-compose.yml` 编排了全部服务：

```bash
cp .env.example .env
# 编辑 .env：JWT_SECRET、LLM_API_KEY 等

docker compose up -d
docker compose logs backend   # 查看初始管理员密码
```

服务组成：

| 服务 | 说明 |
|------|------|
| `frontend` | Nginx 托管前端静态资源，并反向代理 `/api` |
| `backend` | FastAPI 应用，启动时自动执行数据库迁移 |
| `postgres` | PostgreSQL 17 + pgvector，持久化卷存储 |

## 反向代理与域名

部署到公网时，建议在最外层再加一层网关（Caddy / Nginx / Traefik）：

- 终止 TLS，强制 HTTPS（JWT 在 Header 中传输）
- 将域名流量转发到 `frontend` 容器的 80 端口即可，`/api` 已由前端 Nginx 代理到后端
- SSE 流式接口需要网关**关闭响应缓冲**（如 Nginx 的 `proxy_buffering off;`），否则 AI 回复会"整段弹出"而非逐字流出

## 数据库

- **生产**：使用编排中的 PostgreSQL + pgvector，向量检索与混合检索完整可用
- **开发 / 体验**：可将 `DATABASE_URL` 指向 SQLite（见[快速开始](/guide/getting-started#无-docker-的-sqlite-模式)），向量检索自动降级为关键词检索

数据库结构由 Alembic 迁移管理，后端启动时自动升级到最新版本，无需手工执行。

## 版本更新

FlowMind 使用根目录 `VERSION` 作为唯一版本号，并在 `vX.Y.Z` Tag 发布时由 GitHub Actions 构建以下镜像：

- `ghcr.io/lxfight/flowmind-backend:X.Y.Z`
- `ghcr.io/lxfight/flowmind-frontend:X.Y.Z`
- `ghcr.io/lxfight/flowmind-updater:X.Y.Z`

超级管理员可在 **系统更新** 页面检查 GitHub Release、阅读发布说明并执行更新。`updater` 是独立容器，只有它挂载 Docker Socket；业务后端通过带时间戳的 HMAC 请求与其通信。

生产环境必须在 `.env` 中设置随机更新密钥：

```bash
printf 'FLOWMIND_UPDATER_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env
```

更新顺序如下：

1. 拒绝脏工作区、并发任务和无效版本号。
2. 验证远端 `vX.Y.Z` Tag，检查 Docker 与可用磁盘空间。
3. 将 PostgreSQL 备份到 `updater_state` 数据卷。
4. 拉取指定版本镜像，重建前后端并自动执行 Alembic 迁移。
5. 检查前后端健康状态；失败时恢复上一代码与镜像。

数据库迁移不会自动降级。更新失败时备份会保留，由管理员评估后手工恢复，避免自动覆盖生产数据。

没有管理界面时，可在仓库根目录执行：

```bash
scripts/update.sh 0.2.0
```

首次从旧版升级到带 updater 的版本，执行：

```bash
git pull
docker compose up -d --build
```

旧版 updater 如果因仓库所有权检查报错 `detected dubious ownership`，在仓库根目录执行一次：

```bash
docker compose exec -T updater git config --global --add safe.directory "$PWD"
```

然后回到系统更新页重试。更新到包含修复的版本后，updater 会为每次 Git 调用安全地限定当前项目目录，不再依赖容器内的全局配置。

GHCR 镜像必须对部署主机可读；私有仓库需先执行 `docker login ghcr.io`。配置数据、上传文件和数据库卷不会因容器重建而删除。

匿名 GitHub API 受请求配额限制。需要稳定显示完整 Release 说明时，可在 `.env` 配置只读 `GITHUB_TOKEN`；没有 Token 或 API 被限流时，系统仍会通过 GitHub 的最新 Release 重定向识别版本号。

## 文档站部署（GitHub Pages）

本仓库自带 GitHub Actions 工作流（`.github/workflows/deploy-docs.yml`）：`main` 分支上 `docs-site/` 目录或该工作流变更时，自动构建 VitePress 站点并发布到 GitHub Pages。

首次启用需在仓库设置中：**Settings → Pages → Build and deployment → Source 选择 "GitHub Actions"**。
