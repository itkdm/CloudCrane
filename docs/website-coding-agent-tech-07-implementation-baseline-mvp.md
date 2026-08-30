# CloudCrane（筑云鹤）技术架构基线 07：工程实现基线、技术栈与 MVP Vertical Slice

> 文档版本：V0.1  
> 状态：已确认 / Implementation Baseline  
> 更新时间：2026-08-30
>
> 前置文档：
> - `website-coding-agent-product-definition-v0.1.md`
> - `website-coding-agent-tech-01-workspace.md`
> - `website-coding-agent-tech-02-remote-execution-gateway.md`
> - `website-coding-agent-tech-03-preview-production-release-persistence.md`
> - `website-coding-agent-tech-04-agent-runtime-pi.md`
> - `website-coding-agent-tech-05-remote-tools-client-preview.md`
> - `website-coding-agent-tech-06-context-agents-skills.md`
>
> 本文之后，项目从“架构设计阶段”正式进入“实现 → 验证 → 回补架构”阶段。
>
> 原则：
>
> **不再继续横向设计未来所有能力，只冻结第一阶段实现真正需要的技术决策。**

---

# 1. 当前阶段判断

前 6 份技术文档已经冻结了最容易造成大规模返工的一级架构：

```text
Product
↓
Website Workspace
↓
Workspace Gateway / Runner / Daemon
↓
Preview / Production / Release / Persistence
↓
Pi Agent Runtime
↓
Remote Coding Tools / Client-assisted Preview
↓
System Prompt / AGENTS.md / Skills
```

继续在没有真实代码的情况下提前设计：

```text
完整 AgentRun 状态机
复杂 Crash Resume
多 Agent
复杂审批
多 Session Git Worktree
Skill Marketplace
完整 CMS Tool
计费
多节点调度
```

边际收益已经很低。

因此从本文开始：

> **以可运行 Vertical Slice 驱动后续架构。**

---

# 2. V1 工程目标

第一阶段不是做完整产品。

第一阶段只证明下面这条链路真实可运行：

```text
创建 Website
↓
创建 Website Workspace
↓
启动 PbootCMS Dev Runtime
↓
打开一个 Pi Session
↓
用户输入修改要求
↓
Pi Agent 调用 read / edit / bash
↓
Remote Operations
↓
Workspace Gateway
↓
Workspace 真实文件被修改
↓
Preview 刷新
↓
用户在右侧看到修改结果
```

如果这条链路跑通：

> Website Coding Agent 的核心产品闭环就成立。

---

# 3. 固定技术栈

## 3.1 语言

统一：

```text
TypeScript
```

主要业务服务：

```text
Node.js 22
```

原因：

```text
Pi 原生 TS / Node
前后端统一语言
Remote Agent Runtime 不需要跨 Python / Java
共享类型方便
降低 MVP 复杂度
```

---

# 4. Monorepo

V1 使用：

```text
pnpm workspace
```

推荐同时使用：

```text
Turborepo
```

负责：

```text
dev
build
test
lint
typecheck
```

Turborepo 只是工程编排工具。

不允许业务代码依赖 Turborepo 概念。

如果第一阶段发现 Turborepo 没有带来实际收益，可以只保留 pnpm workspace。

---

# 5. Repository Structure

第一阶段推荐：

```text
website-agent/
│
├── apps/
│   ├── web/
│   ├── agent-service/
│   ├── workspace-gateway/
│   └── runner/
│
├── packages/
│   ├── shared/
│   ├── db/
│   ├── pi-adapter/
│   ├── website-agent/
│   ├── workspace-client/
│   └── workspace-protocol/
│
├── docker/
│   ├── workspace-pboot/
│   └── compose/
│
├── docs/
│
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

第一阶段暂不单独建立：

```text
cms-pboot
publish-service
browser-service
skill-service
scheduler-service
```

没有真实代码需求就不提前拆包。

---

# 6. apps/web

采用：

```text
Next.js
React
TypeScript
```

使用当前项目初始化时选定的稳定版本，并通过 lockfile 精确锁定。

职责：

```text
Website UI
Website CRUD
Session List
Agent Chat UI
Live Preview UI
普通 HTTP API
认证入口
```

不运行：

```text
长生命周期 Agent Loop
远程 Shell
Docker 控制
```

---

# 7. UI 技术

第一阶段推荐：

```text
Tailwind CSS
shadcn/ui
```

目标：

```text
快速构建产品 UI
不投入大量基础组件成本
仍然允许后续完全自定义视觉
```

第一阶段 UI 重点只有：

```text
Website 列表
Website 工作台
左/中 Agent Chat
右侧 Live Preview
基本运行状态
```

不先做完整 Design System。

---

# 8. apps/agent-service

采用：

```text
Node.js
Fastify
WebSocket
Pi Coding Agent SDK
```

核心依赖：

```text
@earendil-works/pi-coding-agent
```

使用：

> 精确版本锁定。

不使用：

```text
^latest
```

职责：

```text
Pi AgentSession
Session Runtime
LLM Streaming
Tool Calling
Steering / Follow-up
Compaction
ResourceLoader
AgentRun runtime
Preview Client request
```

---

# 9. 为什么 Agent Service 使用 Fastify

Agent Service 需要：

```text
HTTP
WebSocket
长连接
Schema validation
明确服务生命周期
```

使用轻量独立 Node Server 比塞进 Next.js Route Handler 更合适。

Fastify 只负责：

> Service Transport / API。

Pi 仍负责 Agent Loop。

---

# 10. Web 实时通信

V1 使用：

> **WebSocket 作为 Agent 交互主实时通道。**

原因：

需要同时支持：

```text
Server → Client
LLM delta
Tool progress
Agent status
Preview refresh request

Client → Server
User prompt
steer
follow-up
abort
Preview observation response
```

SSE 只适合主要单向 Streaming。

我们的 Preview Client 又天然需要双向通信。

因此不同时维护：

```text
SSE + WebSocket
```

两套 Agent transport。

---

# 11. 普通 API

使用：

```text
HTTP REST
```

处理：

```text
Website CRUD
Session List
Workspace Status
Run History
普通配置
```

WebSocket 不代替所有 HTTP API。

---

# 12. WebSocket Envelope

共享最小 Envelope：

```text
type
requestId
websiteId
sessionId?
agentRunId?
timestamp
payload
```

例如：

```text
agent.prompt
agent.abort

agent.status
agent.message.delta
agent.tool.start
agent.tool.update
agent.tool.end

preview.refresh
preview.observe.request
preview.observe.result
```

V1 不追求完整 Event Sourcing。

---

# 13. Protocol Schema

共享协议使用：

```text
Zod
```

用于：

```text
HTTP input
WebSocket message
Gateway message
config validation
```

Pi 自己的 Tool Schema 继续使用 Pi 当前需要的 Schema 体系。

不因为 Pi Tool 使用 TypeBox，就强制整个产品都采用同一个 schema library。

---

# 14. Platform Database

V1 平台控制面使用：

> **PostgreSQL**

Website / PbootCMS 数据仍然是：

> **SQLite**

两者必须明确区分。

```text
Platform PostgreSQL
├── Website metadata
├── Workspace metadata
├── Website Session index
├── AgentRun
├── Runner metadata
└── Audit / operational state

Website SQLite
└── 每个 PbootCMS 网站自己的 CMS 数据
```

---

# 15. 为什么 Platform DB 不使用 Website SQLite

Website SQLite 的优势来自：

```text
每网站独立
写入很少
PbootCMS 原生支持
```

Platform 本身却存在：

```text
Web
Agent Service
Gateway
Runner
多个进程
Session metadata
Run state
Mutation Lease
```

因此 Platform 控制面直接使用 PostgreSQL 更自然。

不因为当前只有一台 2C4G ECS，就把 Platform Data Model 绑定到单文件数据库。

---

# 16. ORM

V1 使用：

```text
Drizzle ORM
```

理由：

```text
TypeScript 原生体验
SQL 透明
轻量
Migration 清晰
适合当前相对简单的数据模型
```

不引入复杂 Repository / DDD abstraction。

数据库访问通过：

```text
packages/db
```

统一组织。

---

# 17. Redis

V1：

> **不使用 Redis。**

当前没有必须引入 Redis 的问题。

暂不用于：

```text
Queue
Session
Cache
Lock
Pub/Sub
```

第一阶段：

```text
Agent Service 单实例
Runner 数量很少
```

Mutation Lease 可以先使用：

```text
PostgreSQL row / advisory lock
```

或单 Agent Service 的受控内存调度 + DB 状态。

等出现真实跨实例需求再加 Redis。

---

# 18. Message Queue

V1：

> **不使用 Kafka / RabbitMQ / RocketMQ / BullMQ。**

Runner 与 Gateway 使用：

```text
Persistent WSS
```

Agent 与 Client 使用：

```text
WebSocket
```

当前不需要为了“架构完整”引入消息队列。

---

# 19. apps/workspace-gateway

采用：

```text
Node.js
Fastify
WebSocket
```

职责：

```text
Agent Tool Auth
workspaceId routing
requestId / traceId
Tool Policy
timeout
cancel
stream relay
Runner registry
Audit integration
```

不操作 Docker。

---

# 20. apps/runner

采用：

```text
Node.js
```

Runner 是 ECS Host 上受信任服务。

职责：

```text
连接 Workspace Gateway
heartbeat
Workspace lifecycle
Docker container create/start/stop
volume mount
port allocation
resource quota
Daemon routing
```

---

# 21. Docker Engine

Runner 第一阶段通过：

```text
Docker Engine API
```

操作 Container。

可以使用成熟 Node Docker Client 封装。

但必须隐藏在：

```text
DockerWorkspaceProvider
```

后面。

Agent / Workspace / Web 永远不拿：

```text
docker.sock
```

---

# 22. WorkspaceProvider

继续沿用：

```text
WorkspaceProvider
```

V1：

```text
DockerWorkspaceProvider
```

未来：

```text
ACSAgentSandboxWorkspaceProvider
```

第一阶段只实现当前 Vertical Slice 所需方法：

```text
create
start
stop
getStatus
getEndpoint
```

不要一开始实现完整未来 Capability API。

---

# 23. Workspace Image

第一阶段制作：

```text
website-workspace-pboot:v1
```

包含：

```text
Linux userspace
PHP
PbootCMS runtime requirements
Git
SQLite CLI
ripgrep
常用 shell tools
Workspace Daemon
```

默认工作目录：

```text
/workspace
```

默认用户：

```text
workspace
```

非 root。

---

# 24. Workspace Persistent Directory

V1：

```text
/site-data/{websiteId}/workspace/
```

挂载：

```text
Host
↓
Workspace Container /workspace
```

其中包括：

```text
Website Source
.git
AGENTS.md
.agents/skills/
```

---

# 25. Workspace Daemon

V1 不做复杂 Remote IDE Protocol。

只实现：

```text
fs.read
fs.write
fs.stat
fs.list
fs.mkdir

process.exec
process.cancel

runtime.health
```

足够支撑：

```text
Pi read
Pi edit
Pi write
Pi bash
Pi ls
```

---

# 26. Runner → Workspace Daemon

第一阶段：

```text
Workspace Daemon :7070
```

只映射：

```text
127.0.0.1:{randomPort}
```

Runner 本地访问。

不公开到互联网。

后续再评估 UDS。

---

# 27. Runner → Gateway

使用：

```text
Outbound WSS
```

Runner 主动连接 Gateway。

V1 不使用：

```text
Gateway SSH ECS
```

正式执行。

SSH 仅：

```text
break-glass / 运维调试
```

---

# 28. Pi Runtime

使用 Tech-04 已确定的：

```text
@earendil-works/pi-coding-agent
```

优先直接复用：

```text
AgentSession
SessionManager
Tree
Fork
Clone
Compaction
Steering
Follow-up
Skills
Extensions
ModelRuntime
```

---

# 29. Pi Tool

第一阶段：

```text
read
edit
write
bash
```

必须首先跑通。

随后：

```text
ls
find
```

第一阶段内可以补。

内容搜索先：

```text
bash + rg
```

---

# 30. Remote Operations

Pi Tool：

```text
read
edit
write
bash
```

内部 Execution 替换为：

```text
Remote Operations Adapter
↓
workspace-client
↓
Workspace Gateway
```

这是 Vertical Slice 最核心的集成点。

---

# 31. Session Persistence

继续使用 Pi 当前成熟：

```text
SessionManager JSONL
```

Session 文件属于 Website 的 Agent runtime state。

第一阶段可以存：

```text
/site-data/{websiteId}/agent/sessions/
```

不重新建立完整 Message 表。

---

# 32. Skills / AGENTS.md

继续使用 Tech-06：

```text
/workspace/AGENTS.md
/workspace/.agents/skills/
```

第一阶段只需要验证：

```text
Pi 能发现
Pi 能加载
Agent 能 read
```

不做 Skill 管理 UI。

---

# 33. Preview

第一阶段只需要：

```text
stable preview route
+
右侧 iframe / webview
+
refresh
```

目标：

> Agent 修改文件以后，用户马上看到变化。

---

# 34. Preview Gateway

第一阶段可以先实现最简单：

```text
Host
↓
websiteId
↓
Workspace Runtime
```

Preview URL：

```text
site-{id}.preview.platform-domain.com
```

如果真实公网 DNS / TLS 会明显拖慢本地开发：

开发模式可以先使用：

```text
http://localhost:{gatewayPort}/preview/{websiteId}/
```

但生产架构仍然保持 Tech-03 的：

```text
stable preview subdomain
```

禁止因为本地开发便利修改正式架构。

---

# 35. Preview Bridge

第一阶段只做最小能力：

```text
READY
REFRESH
CURRENT_URL
CONSOLE_ERROR
```

第二阶段再补：

```text
DOM Snapshot
Screenshot
Element Select
```

原因：

第一条 Vertical Slice 首先验证：

```text
Agent 能否改真实网站
用户能否实时看到
```

视觉 Agent 验证不是第一个阻塞点。

---

# 36. Client-assisted Preview

架构保持：

```text
ClientPreviewProvider
```

第一阶段 UI 已经保留：

```text
Agent Chat
+
Live Preview
```

后续增加 DOM / Screenshot 不需要重构。

---

# 37. Caddy

V1 部署入口使用：

```text
Caddy
```

职责：

```text
HTTP/HTTPS entry
Web
Agent Service WS
Workspace Gateway WS
Preview Gateway
Production Gateway
```

第一阶段本地开发不要求 Caddy 才能启动。

生产/远程开发环境再接 Caddy。

---

# 38. Logging

所有 Node Service 使用结构化日志。

推荐：

```text
Pino
```

字段至少：

```text
service
requestId
traceId
websiteId
sessionId
agentRunId
workspaceId
runnerId
durationMs
status
error
```

第一阶段直接把日志打完整。

后续再区分：

```text
dev verbose
production important
```

---

# 39. Trace

第一阶段不引入完整 OpenTelemetry Infrastructure。

但所有跨服务请求必须携带：

```text
traceId
requestId
```

以便以后直接接：

```text
OpenTelemetry
```

---

# 40. Test Stack

统一：

```text
Vitest
```

用于：

```text
unit test
integration test
protocol test
```

HTTP / WebSocket 可以使用各服务自己的 test client。

---

# 41. E2E

第一阶段产品 UI E2E 暂不作为阻塞项。

当 Vertical Slice 稳定后增加：

```text
Playwright Test
```

用于：

```text
Web UI
Agent → Preview flow
```

注意：

> Playwright Test 是产品测试工具。

与 Tech-05 中是否使用服务端 Headless Browser Agent 是两个问题。

---

# 42. Lint / Format

使用：

```text
ESLint
Prettier
```

第一阶段不要投入时间研究替代工具。

统一：

```text
lint
format
typecheck
test
```

即可。

---

# 43. Environment Config

使用：

```text
.env
+
typed config validation
```

启动时必须校验。

不允许运行到 Tool Call 时才发现：

```text
DATABASE_URL missing
```

---

# 44. Secret Boundary

以下 Secret 只在 Control Plane：

```text
LLM API Keys
Platform DB
OSS Credential
JWT / Auth Secret
```

不得进入：

```text
Workspace Container
Pi Remote Bash env
Website Source
```

---

# 45. Platform 最小数据模型

第一阶段只建立：

```text
website
workspace
website_session
agent_run
runner
```

如果 Tool Audit 实现需要：

```text
tool_execution
```

可以增加。

---

# 46. website

第一阶段字段概念：

```text
id
name
status
cmsType

createdAt
updatedAt
```

暂不加入几十个未来配置字段。

---

# 47. workspace

概念：

```text
id
websiteId

provider
runnerId

status
containerRef

workspacePath
previewPort

createdAt
updatedAt
```

---

# 48. website_session

概念：

```text
id
websiteId

piSessionId
sessionFile

title
status

createdAt
updatedAt
lastActiveAt
```

---

# 49. agent_run

第一阶段只需要：

```text
id
websiteId
sessionId

status

startedAt
endedAt

model
error
```

AgentRun 完整状态机暂不冻结。

真实运行以后再依据 Pi Event 修正。

---

# 50. runner

概念：

```text
id
name
status

lastHeartbeatAt

metadata
```

单机仍然保留 runnerId。

这样以后增加 4C8G Server 不需要改数据模型。

---

# 51. V1 AgentRun 状态先保持简单

第一阶段：

```text
PENDING
RUNNING
COMPLETED
FAILED
ABORTED
INTERRUPTED
```

暂不加入：

```text
VERIFYING
WAITING_USER
WAITING_APPROVAL
COMPACTING
RECOVERING
```

先看真实 Pi Runtime 是否真的需要持久化这些状态。

---

# 52. Vertical Slice 01

正式第一条实现目标：

> **Agent 修改真实 PbootCMS Workspace，并在右侧 Preview 中立即看到结果。**

---

# 53. Vertical Slice 01 用户路径

```text
1. 打开 Website Platform
2. 创建一个测试 Website
3. Platform 创建 Workspace
4. Workspace 启动 PbootCMS
5. 右侧 Preview 可以正常访问
6. 创建 / 打开 Pi Session
7. 用户输入：

   “把首页标题改成 Hello Website Agent”

8. Agent 调用 read
9. Agent 调用 edit
10. Workspace 文件真实变化
11. Preview Refresh
12. 用户看到标题已经修改
13. Agent 返回完成结果
```

做到这里：

> MVP Core Loop 首次闭环。

---

# 54. Vertical Slice 01 必须包含

必须真实实现：

```text
Monorepo
PostgreSQL metadata
Website record

Runner
DockerWorkspaceProvider
Workspace Container
Workspace Daemon

Workspace Gateway
Runner WSS

Agent Service
Pi SDK

Remote read
Remote edit
Remote write
Remote bash

WebSocket Agent Stream

Website Workbench UI
Live Preview

Pi Session Persistence
```

---

# 55. Vertical Slice 01 可以临时简化

允许：

```text
单用户
单 Runner
单 Agent Service
单 Gateway
单 ECS
只有 PbootCMS
只有一个 workspace image
没有 Production Publish
没有 custom domain
没有复杂 Skill UI
没有 visual screenshot verify
没有 CMS semantic Tool
没有多 Session 并发 mutation
```

简化产品范围。

不能简化已经冻结的安全边界。

---

# 56. Vertical Slice 01 不能走捷径

禁止为了快速 Demo：

```text
Agent Service 直接 fs.read Website
Agent Service 直接 fs.write Website
Agent Service 直接 docker exec
Agent 直接 SSH ECS
Agent 拿 docker.sock
把 Pi Tool 改成本地 Tool
Preview 直接读 Agent 本地副本
```

否则 Demo 跑通也不能验证真实架构。

第一条链路必须真的经过：

```text
Pi
↓
Remote Operations
↓
Workspace Gateway
↓
Runner
↓
Workspace
```

---

# 57. 第一阶段实现顺序

推荐：

```text
Step 1
Monorepo + DB + shared protocol

Step 2
Runner + DockerWorkspaceProvider

Step 3
Workspace Image + Workspace Daemon

Step 4
Workspace Gateway + Runner WSS

Step 5
Workspace create/start + Preview

Step 6
Agent Service + Pi Session

Step 7
Remote read

Step 8
Remote edit/write/bash

Step 9
Web Agent Stream

Step 10
Chat + Live Preview UI

Step 11
End-to-end Vertical Slice

Step 12
Tests + logs + cleanup
```

---

# 58. 第一阶段不要并行实现太多功能

尤其不要同时开发：

```text
Production Publish
Domain
OSS Backup
Skills UI
CMS Tools
Browser Screenshot
User Billing
Complex Auth
```

先让：

```text
Agent → Code → Preview
```

跑通。

---

# 59. Vertical Slice 01 验收标准

必须做到：

1. Website 可以创建；
2. Workspace Container 可以真实创建、停止、再次启动；
3. Website 文件持久化；
4. Preview 可以访问；
5. Pi Session 可以创建、继续；
6. Pi `read` 通过 Gateway 读取 Workspace 文件；
7. Pi `edit/write` 通过 Gateway 修改 Workspace；
8. Pi `bash` 通过 Gateway 在 Workspace 执行；
9. Agent Service 看不到 Docker Socket；
10. Workspace 看不到 Platform Secret；
11. Web 可以流式看到 Agent 输出；
12. 修改后 Preview 可刷新；
13. 浏览器刷新 Chat 页面后 Session 历史仍然存在；
14. Agent Service 重启后可以重新打开 Session；
15. 基础日志能通过 traceId 串起一次执行。

---

# 60. 第一次真实 Demo

推荐只使用一个固定 PbootCMS Base。

测试 Prompt：

```text
读取当前首页实现，把首页最醒目的标题改成
“Hello Website Agent”，保持其他内容不变。
修改完成后检查相关文件，并告诉我修改了什么。
```

重点不是 UI 好不好看。

重点验证：

```text
Pi reasoning
↓
Remote read
↓
Remote edit
↓
Persistent Workspace
↓
Preview result
```

---

# 61. Vertical Slice 02

Vertical Slice 01 稳定以后再做：

```text
Git status / diff / commit
Agent abort
Steering / Follow-up
Page reconnect
Preview Bridge
DOM Observation
Console Errors
AGENTS.md
Skills
```

此时再开始观察：

> 一次 AgentRun 的真实生命周期。

---

# 62. Vertical Slice 03

再进入：

```text
Initial Publish
Production Container
Release Artifact
OSS
Atomic Release
Rollback
```

这样 Tech-03 开始真正落地。

---

# 63. Vertical Slice 04

再进入：

```text
CMS semantic capability
Content operation
SQLite backup
Production content
```

是否需要提前做由前几阶段反馈决定。

---

# 64. Architecture Feedback Loop

从现在开始：

```text
Architecture
↓
Implement
↓
Run
↓
Observe
↓
发现真实问题
↓
修改实现
↓
必要时更新 ADR
```

而不是：

```text
Architecture
↓
Architecture
↓
Architecture
↓
Architecture
```

---

# 65. 何时允许修改已冻结架构

只有出现：

```text
Pi 实际 API 与假设明显不同
Remote Operations 无法满足需求
性能 / 安全真实不成立
PbootCMS Runtime 产生新约束
开发复杂度明显失控
真实用户体验证明原方案不合理
```

才修改前面的 ADR。

不能因为：

```text
“另一种架构也不错”
```

就反复重做。

---

# 66. Coding Agent 开发流程

后续采用：

```text
确定当前 Vertical Slice
↓
ChatGPT 给本地 Coding Agent 实现 Prompt
↓
Coding Agent 先读 Tech-01 ~ Tech-07
↓
实现
↓
测试
↓
Commit / Push
↓
ChatGPT Review
↓
只处理真实问题
↓
进入下一阶段
```

---

# 67. 文档维护原则

从 Tech-07 开始：

> 不再为每个实现细节创建一份新的一级 Tech 文档。

如果只是：

```text
接口字段
某个 Tool 错误码
某个类实现方式
```

应该写：

```text
代码
README
ADR 补充
```

只有出现新的一级架构问题，才新增 Tech-08。

---

# 68. 当前固定技术栈总结

```text
Language
├── TypeScript
└── Node.js 22

Monorepo
├── pnpm workspace
└── Turborepo

Web
├── Next.js
├── React
├── Tailwind CSS
└── shadcn/ui

Node Services
├── Fastify
├── WebSocket
└── Zod

Agent
└── @earendil-works/pi-coding-agent

Platform Data
├── PostgreSQL
└── Drizzle ORM

Website CMS Data
└── SQLite

Workspace
├── Docker
├── DockerWorkspaceProvider
├── Runner
└── Workspace Daemon

Gateway
└── WSS

Reverse Proxy
└── Caddy

Logging
└── Pino

Test
├── Vitest
└── Playwright Test（后续 E2E）

Package Manager
└── pnpm
```

明确不使用：

```text
Redis（V1）
Kafka / RabbitMQ / RocketMQ（V1）
LangGraph
Kubernetes
Microservices Platform
Service Mesh
Central Skill Service
Server Browser Service（V1）
```

---

# 69. Architecture Decisions

## ADR-112

项目正式结束纯架构探索阶段，进入 Vertical Slice 驱动实现阶段。

## ADR-113

主语言统一为 TypeScript，运行时使用 Node.js 22。

## ADR-114

项目采用 pnpm workspace Monorepo，Turborepo 仅负责工程任务编排。

## ADR-115

Web 使用 Next.js + React。

## ADR-116

Agent Service、Workspace Gateway 使用独立 Node.js Service。

## ADR-117

Agent 实时交互主通道使用 WebSocket，而不是同时维护 SSE + WebSocket。

## ADR-118

普通业务 CRUD 使用 HTTP REST。

## ADR-119

共享协议使用 Zod 进行运行时校验。

## ADR-120

Platform 控制面数据使用 PostgreSQL + Drizzle ORM。

## ADR-121

PbootCMS Website 自身继续使用每网站独立 SQLite。

## ADR-122

V1 不引入 Redis 和 Message Queue。

## ADR-123

Runner 通过 DockerWorkspaceProvider 管理 Workspace Container，只有 Runner 可以访问 Docker Engine。

## ADR-124

Workspace Daemon V1 只实现第一条 Vertical Slice 所需的最小 fs/process/runtime 能力。

## ADR-125

第一条 Vertical Slice 必须真实通过 Workspace Gateway，不允许 Agent Service 直接访问或修改 Website Source。

## ADR-126

第一阶段 Preview 先实现 Live Preview + Refresh，DOM/Screenshot Observation 在下一 Vertical Slice 增强。

## ADR-127

第一阶段只建立 website、workspace、website_session、agent_run、runner 等必要 Platform Data Model。

## ADR-128

AgentRun 状态 V1 先保持最小集合，待真实 Pi Runtime 跑通后再冻结完整生命周期。

## ADR-129

Tech-07 之后不再为普通实现细节持续创建一级架构文档，优先通过代码和真实运行反馈推进。

---

# 70. 最终实现路线

```text
现在
 │
 ↓
Tech-07 冻结
 │
 ↓
Project Scaffold
 │
 ↓
Runner
 │
 ↓
Workspace
 │
 ↓
Gateway
 │
 ↓
Pi Agent
 │
 ↓
Remote Tools
 │
 ↓
Chat + Live Preview
 │
 ↓
Vertical Slice 01
 │
 ↓
真实运行反馈
 │
 ├── 修实现
 ├── 补测试
 └── 必要时更新 ADR
 │
 ↓
继续 Product Development
```

---

# 71. 一句话总结

> **前 7 份基线已经足以开工。接下来不再试图提前设计完整 Website Agent，而是先用固定的 TypeScript / Node / Next.js / Pi / PostgreSQL / Docker 技术栈跑通“Agent 修改真实 PbootCMS Workspace → 用户实时看到 Preview”的第一条 Vertical Slice，再让真实代码决定下一步需要补什么架构。**
