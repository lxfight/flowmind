# 外部集成

FlowMind 可以把任务、评论和里程碑变化可靠地推送到自动化平台、团队机器人或自建服务。第一版提供项目级出站 Webhook，并通过 Transactional Outbox 保证业务数据与待投递事件在同一个数据库事务中提交。

## 适用方式

| 目标平台 | 推荐接法 |
|---|---|
| n8n、Make、Zapier、自建 API | 直接接收 FlowMind JSON Webhook |
| 飞书、企业微信、钉钉、Slack、Discord | 先经过轻量中转服务，校验签名并转换为平台消息格式 |
| 内网自动化服务 | 超级管理员开启“允许内网地址”，使用容器可访问的服务地址 |

```text
FlowMind 业务事务
  -> PostgreSQL Transactional Outbox
  -> notifier Worker
  -> 你的接收端
  -> IM 机器人 / 自动化流程 / 外部系统
```

## 创建 Webhook

1. 进入项目的“集成”页面，点击“添加 Webhook”。
2. 填写名称和接收地址，选择需要订阅的事件。
3. 创建后立即保存签名密钥。密钥只显示一次，之后只能重新生成。
4. 点击“发送测试”，在“投递记录”中确认响应状态。

项目所有者和管理员可以管理集成。只有超级管理员能允许私网地址。

## 可订阅事件

| 事件 | 触发时机 |
|---|---|
| `task.created` | 创建任务 |
| `task.updated` | 修改任务字段 |
| `task.moved` | 任务切换状态列或排序位置 |
| `task.completed` | 任务完成或重新打开 |
| `task.deleted` | 删除任务 |
| `comment.created` | 新增任务评论 |
| `milestone.created` | 创建里程碑 |
| `milestone.updated` | 修改里程碑字段 |
| `milestone.completed` | 里程碑完成或重新打开 |
| `milestone.deleted` | 删除里程碑 |

一次业务操作可能产生多个语义明确的事件。例如把任务移动到完成列时，会同时产生 `task.moved` 和 `task.completed`。

## 请求格式

FlowMind 使用 HTTP `POST` 发送紧凑 JSON，并携带以下请求头：

```http
Content-Type: application/json
User-Agent: FlowMind-Webhook/1.0
X-FlowMind-Event: task.completed
X-FlowMind-Delivery: 8b114f4e-...
X-FlowMind-Timestamp: 1785466800
X-FlowMind-Signature: v1=34d14e...
```

事件体示例：

```json
{
  "id": "018fcb6d-...",
  "type": "task.completed",
  "version": 1,
  "occurred_at": "2026-07-31T03:00:00+00:00",
  "project": { "id": 7, "name": "发布项目" },
  "actor": { "id": 1, "username": "admin", "display_name": "管理员" },
  "resource": { "type": "task", "id": 123 },
  "data": {
    "id": 123,
    "title": "正式发布",
    "status_id": 4,
    "is_completed": true
  },
  "changes": {
    "is_completed": { "from": false, "to": true }
  },
  "url": "https://flowmind.example.com/project/7/board?task=123"
}
```

`X-FlowMind-Delivery` 在一次逻辑投递的所有重试中保持不变，接收端应使用它做幂等去重。

## 校验签名

签名算法为 HMAC-SHA256，原文是时间戳、英文句点和未经解析的原始请求体：

```text
HMAC_SHA256(secret, timestamp + "." + raw_body)
```

Node.js / Express 示例：

```js
import crypto from 'node:crypto'
import express from 'express'

const app = express()
const secret = process.env.FLOWMIND_WEBHOOK_SECRET

app.post('/flowmind', express.raw({ type: 'application/json' }), async (req, res) => {
  const timestamp = req.header('X-FlowMind-Timestamp') ?? ''
  const received = req.header('X-FlowMind-Signature') ?? ''
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(req.body)
    .digest('hex')
  const expected = `v1=${digest}`

  const valid = received.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
    && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300

  if (!valid) return res.status(401).send('invalid signature')

  const event = JSON.parse(req.body.toString('utf8'))
  await enqueueForProcessing(event, req.header('X-FlowMind-Delivery'))
  return res.sendStatus(204)
})
```

必须基于原始字节计算签名；先解析再重新序列化 JSON 会改变签名。建议拒绝与当前时间相差超过 5 分钟的请求。

## 连接团队机器人

飞书、企业微信、钉钉等机器人要求各自的消息结构，不能直接消费通用事件体。中转服务校验 FlowMind 签名后，将事件转换为目标平台格式即可：

```js
const content = `[${event.project.name}] ${event.actor.display_name} 完成了任务：${event.data.title}`

await fetch(platformWebhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    msgtype: 'text',
    text: { content },
  }),
})
```

生产环境建议让中转服务先持久化事件并立即向 FlowMind 返回 `2xx`，再异步调用目标平台，避免平台响应慢导致重复投递。

## 重试与运维

- `2xx` 表示投递成功。
- `408`、`409`、`425`、`429` 和 `5xx` 会重试。
- 默认重试间隔依次为 1 分钟、5 分钟、15 分钟、1 小时、6 小时和 24 小时，最多尝试 6 次。
- 接收端返回 `Retry-After` 时，FlowMind 会在合理范围内优先采用该时间。
- 默认连续失败 20 次会自动暂停集成并通知项目管理员。
- 失败或已取消的记录可在“投递记录”中人工重新投递。

部署参数和内网地址注意事项见[配置说明](/guide/configuration)与[部署指南](/guide/deployment#外部通知部署注意事项)。
