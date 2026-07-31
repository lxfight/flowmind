# 部署

## Docker Compose 部署

仓库根目录的 `docker-compose.yml` 编排了全部服务：

```bash
cp .env.example .env
# 编辑 .env：JWT_SECRET、LLM_API_KEY 等

./scripts/deploy.sh
docker compose logs backend   # 查看初始管理员密码
```

部署脚本会分别探测 PyPI、npm、Debian 和 Alpine 的官方源与国内镜像，自动选择可用且明显更快的地址，并缓存选择结果、启用 BuildKit 依赖缓存。后续重建即使依赖清单变化，也会复用 apt、pip、uv、npm 与 apk 下载缓存。

```bash
./scripts/deploy.sh --detect-only                    # 只查看镜像源选择
./scripts/deploy.sh --detect-only --refresh-mirrors  # 重新测速但不构建
FLOWMIND_MIRROR_MODE=official ./scripts/deploy.sh    # 强制官方源
FLOWMIND_MIRROR_MODE=china ./scripts/deploy.sh       # 强制国内源
./scripts/deploy.sh backend frontend                 # 只重建指定服务
```

服务组成：

| 服务 | 说明 |
|------|------|
| `frontend` | Nginx 托管前端静态资源，并反向代理 `/api` |
| `backend` | FastAPI 应用，启动时自动执行数据库迁移 |
| `notifier` | 独立扫描 Transactional Outbox，签名并投递外部 Webhook |
| `postgres` | PostgreSQL 17 + pgvector，持久化卷存储 |
| `updater` | 编排在线更新、数据库备份、健康检查与失败恢复 |

`notifier` 与后端复用同一镜像，但以独立进程运行。业务写入和外部投递解耦，即使目标平台暂时不可用，也不会阻塞任务、评论或里程碑操作。

## 反向代理与域名

部署到公网时，建议在最外层再加一层网关（Caddy / Nginx / Traefik）：

- 终止 TLS，强制 HTTPS（JWT 在 Header 中传输）
- 将域名流量转发到 `frontend` 容器的 80 端口即可，`/api` 已由前端 Nginx 代理到后端
- SSE 流式接口需要网关**关闭响应缓冲**（如 Nginx 的 `proxy_buffering off;`），否则 AI 回复会"整段弹出"而非逐字流出
- 配置 Webhook 前应设置 `PUBLIC_APP_URL=https://你的域名`，让外部通知中的任务与里程碑链接可直接访问

## 外部通知部署注意事项

- 公网 Webhook 默认只允许 HTTPS，并在保存配置和每次投递前检查域名解析结果，阻止回环、链路本地和私网地址。
- 只有超级管理员可以为可信的自托管接收服务开启“允许内网地址”。
- Docker 中的 `127.0.0.1` 指向 `notifier` 容器本身。macOS 宿主机服务可使用 `host.docker.internal`，同一 Compose 网络内应使用接收服务名。
- 接收端应先校验 HMAC 签名，再将事件加入自己的队列，并尽快返回 `2xx`。
- `INTEGRATION_ENCRYPTION_KEY` 必须纳入密钥备份；更换后应逐个轮换 Webhook 密钥。

完整配置、签名校验和平台适配方式见[外部集成](/features/integrations)。

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

宿主机端口也应保存在 `.env`，不要直接修改受 Git 管理的 `docker-compose.yml`：

```bash
POSTGRES_PORT=5432
BACKEND_PORT=8000
FRONTEND_PORT=80
```

updater 会保留 `.env`，因此这些机器级配置不会随版本切换丢失；受 Git 管理的源码和 Compose 模板则必须保持与发布版本一致，避免更新时静默覆盖本地修改。

更新顺序如下：

1. 拒绝脏工作区、并发任务和无效版本号。
2. 验证远端 `vX.Y.Z` Tag，检查 Docker 与可用磁盘空间。
3. 按数据库体量检查 `updater_state` 空间，并将 PostgreSQL 备份到该数据卷。
4. 拉取指定版本镜像，重建前后端并自动执行 Alembic 迁移。
5. 检查前后端健康状态，并核对后端实际版本；失败时恢复上一代码与镜像。

updater 会在切换代码前记录恢复检查点。若容器或宿主机在部署期间重启，updater 再次启动时会尝试恢复上一版本的代码、`.env` 版本和应用容器，并把结果写回更新历史。初始部署脚本也会等待 Compose 健康检查通过后才返回成功。

备份完成后默认必须至少保留 1 GiB 可用空间；可通过 `.env` 的 `FLOWMIND_UPDATE_MIN_FREE_BYTES` 调整。空间不足时更新会在切换代码和服务前终止。

数据库迁移不会自动降级。更新失败时备份会保留，由管理员评估后手工恢复，避免自动覆盖生产数据。

没有管理界面时，可在仓库根目录执行：

```bash
scripts/update.sh 0.3.0
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

updater 获取版本代码时保持执行完整的 `git fetch --tags`。它会先使用仓库的 `origin`；官方 GitHub 超时或失败后，再依次尝试以下 Git Smart HTTP 加速前缀：

- `https://edgeone.gh-proxy.com`
- `https://hk.gh-proxy.com`
- `https://gh-proxy.com`
- `https://gh.dpik.top`

加速地址的使用格式为 `加速前缀/完整 GitHub 仓库 URL`。它们是第三方服务，只在 `origin` 拉取失败后临时用于获取 Tags，不会替换仓库 `origin`。可在 `.env` 自定义顺序，或在安全策略不允许第三方中转时禁用：

```bash
FLOWMIND_GITHUB_ACCELERATORS=off
FLOWMIND_GIT_FETCH_TIMEOUT=45
```

## 文档站部署（GitHub Pages）

本仓库自带 GitHub Actions 工作流（`.github/workflows/deploy-docs.yml`）：`main` 分支上 `docs-site/` 目录或该工作流变更时，自动构建 VitePress 站点并发布到 GitHub Pages。

首次启用需在仓库设置中：**Settings → Pages → Build and deployment → Source 选择 "GitHub Actions"**。
