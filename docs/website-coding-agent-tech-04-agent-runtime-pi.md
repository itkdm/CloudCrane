# CloudCrane（筑云鹤）技术架构基线 04：Agent Runtime（Pi-first）

> 文档版本：V0.1  
> 状态：已确认 / Final Baseline  
> 更新时间：2026-08-30  
>
> 前置文档：
> - `website-coding-agent-product-definition-v0.1.md`
> - `website-coding-agent-tech-01-workspace.md`
> - `website-coding-agent-tech-02-remote-execution-gateway.md`
> - `website-coding-agent-tech-03-preview-production-release-persistence.md`
>
> Pi 源码核对基线：
> - Repository: `earendil-works/pi`
> - Branch: `main`
> - Reviewed Commit: `853a80d26c90a14c1886f0ebb8ffaae133ca2185`
> - `@earendil-works/pi-coding-agent`: 0.84.4
> - License: MIT
> - Node.js: >= 22.19.0

---

# 1. 本文解决的问题

本文冻结 Website Coding Agent 的 AI Agent Runtime 方案。

核心问题不是“如何从零实现一个 Coding Agent”，而是：

> **如何最大程度复用已经成熟的 Pi Coding Agent，同时保持 Website Agent 自己的产品能力、Workspace 安全边界和长期可演进性。**

本文重点确定：

- Agent 技术栈；
- Next.js 与 Agent Runtime 的边界；
- 是否直接使用 Pi SDK；
- 是否 Fork Pi；
- Pi 哪些能力直接复用；
- Website 自己实现哪些能力；
- Website 与 Pi Session 的关系；
- Session / Tree / Fork / Clone / Compaction 如何处理；
- Pi 的 Coding Tools 如何接入远程 Workspace；
- Browser / CMS / Publish Tool 如何接入；
- System Prompt / Skills / Extensions 如何设计；
- 多 Session 如何共享一个 Website Workspace；
- Agent Service 崩溃后的恢复边界；
- Pi 升级与未来替换策略。

---

# 2. 最终结论

V1 正式采用：

> **TypeScript / Node.js + Next.js Web + 独立 Agent Service + `@earendil-works/pi-coding-agent` SDK。**

不是：

```text
从零实现 Coding Agent
```

也不是：

```text
Fork 整个 Pi 仓库后自行维护
```

也不是：

```text
只使用 pi-agent-core，然后重新实现 Session / Compaction / Fork / Skills
```

而是：

```text
Website Agent Product
        │
        ↓
WebsiteAgentRuntime
        │
        ↓
@earendil-works/pi-coding-agent
        │
        ├── AgentSession / AgentSessionRuntime
        ├── SessionManager
        ├── ModelRuntime
        ├── Compaction
        ├── Tree / Fork / Clone
        ├── Steering / Follow-up
        ├── Skills / Context Files
        ├── Extensions
        └── Coding Tool Definitions
                │
                ↓
       Remote Operations Adapter
                │
                ↓
         Workspace Gateway
```

一句话：

> **Pi 负责成熟 Coding Agent Harness，我们负责 Website Agent 产品能力。**

---

# 3. Agent 架构总原则：Pi-first

正式采用：

> **Pi-first Reuse Principle**

规则：

1. Pi 已经稳定提供，并且与 Website Agent 产品语义一致：
   - 直接复用。

2. Pi 已经提供扩展接口：
   - 使用 Extension、Hook、ResourceLoader、Tool Operations 等接口扩展。

3. Pi 默认实现不适合我们的远程 Workspace：
   - 替换执行后端，不重写 Agent 语义。

4. Pi 缺少 Website 特有能力：
   - 自己实现。

5. Pi 某能力破坏我们已经冻结的：
   - Workspace 隔离；
   - 安全边界；
   - Production / Preview 模型；
   - 用户体验；
   - 产品数据模型；

   才由 Website Agent 接管。

禁止为了“自主可控”而重复实现成熟功能。

同样禁止为了“完全复用 Pi”而牺牲 Website Agent 产品边界。

---

# 4. 为什么最终选择 pi-coding-agent，而不是裸 pi-agent-core

Pi 当前源码已经形成明显分层：

```text
pi-ai
  │
  └── Model / Provider / Streaming

pi-agent-core
  │
  └── Agent Loop / Tool Calling / Events / Queue

pi-coding-agent
  │
  ├── AgentSession
  ├── AgentSessionRuntime
  ├── SessionManager
  ├── Compaction
  ├── Tree / Fork / Clone
  ├── Skills
  ├── Context Files
  ├── Extensions
  ├── ModelRuntime
  └── Coding Tools
```

如果只使用 `pi-agent-core`，我们还要重新解决：

```text
Session persistence
Session restore
Tree navigation
Fork
Clone
Compaction
Skills
Resource discovery
Model restoration
Extension lifecycle
Context files
```

这些并不是我们的产品差异化。

Pi 官方 SDK 本身明确定位就是：

> 嵌入其他应用、构建自定义 UI、接入自动化工作流和自定义工具。

因此 V1 不需要主动退回低层 API。

---

# 5. 为什么不 Fork Pi

第一版不 Fork 整个 Pi。

原因：

Pi 上游会持续维护：

```text
Model Provider
Tool Calling compatibility
Streaming
Retry
Compaction
Session migration
模型参数差异
Anthropic/OpenAI/Google API 变化
```

如果 Fork：

```text
Website Agent
    ↓
长期维护整个 Pi 分支
```

会产生大量没有产品价值的维护工作。

正式采用以下扩展优先级：

```text
Level 1
Pi 官方配置 / SDK API

↓ 不够

Level 2
Extension / ResourceLoader / Custom Tool / Remote Operations

↓ 不够

Level 3
WebsiteAgentRuntime Adapter / Wrapper

↓ 仍然不够

Level 4
给 Pi 上游提交 PR 或使用极小补丁

↓ 最后手段

Level 5
只 Fork 必须修改的目标 package
```

不因为一两个差异 Fork 整仓库。

---

# 6. 技术栈

V1：

```text
TypeScript
Node.js 22
Next.js
Pi Coding Agent SDK
```

逻辑部署：

```text
apps/
├── web/
│   └── Next.js
│
└── agent-service/
    └── Node.js Agent Runtime

packages/
├── website-agent/
├── pi-adapter/
├── workspace-client/
├── website-tools/
├── cms-pboot/
└── shared/
```

V1 仍然可以全部部署在同一台 2C4G ECS。

拆分的是：

> 代码与进程责任。

不是要求第一天增加服务器。

---

# 7. 为什么 Agent Service 不直接放进 Next.js Route Handler

Next.js 负责：

```text
Web UI
Website Management
Session List
用户认证
普通 API
Agent Streaming UI
```

Agent Service 负责：

```text
长生命周期 AgentSession
LLM Streaming
Tool Calling
Steering
Follow-up
Compaction
Session switching
Long-running task
```

Agent Runtime 可能持续：

```text
几分钟
十几分钟
甚至更久
```

它需要：

```text
长连接
AbortSignal
Streaming
Session Runtime
Tool progress
进程生命周期控制
```

因此不应把核心 Agent Loop 强绑定到 Next.js Request 生命周期。

V1：

```text
Next.js
   │
   │ Internal API / SSE / WebSocket
   ↓
Agent Service
```

即可。

---

# 8. 最终 Runtime 架构

```text
                         User Browser
                              │
                              ↓
                          Next.js Web
                              │
                    Auth / Session API
                              │
                              ↓
                    ┌──────────────────┐
                    │   Agent Service  │
                    └────────┬─────────┘
                             │
                  WebsiteAgentRuntime
                             │
                     PiAgentAdapter
                             │
                 AgentSessionRuntime
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        AgentSession    ModelRuntime    ResourceLoader
              │              │              │
              │              │        Skills / Context
              │              │
              ↓              ↓
           Agent Loop      pi-ai
              │
              ↓
             Tools
              │
      ┌───────┼───────────┐
      │       │           │
 Pi Coding   Custom      Policy
  Tools      Tools      Extensions
      │       │           │
      └───────┼───────────┘
              ↓
      WorkspaceGatewayClient
              │
              ↓
       Workspace Gateway
              │
             WSS
              │
              ↓
          ECS Runner
              │
              ↓
       Workspace Daemon
              │
              ↓
        Pboot Workspace
```

---

# 9. Website 与 Session 的最终模型

正式删除额外的 `Conversation` 概念。

采用：

```text
Website
│
├── Pi Session A
├── Pi Session B
├── Pi Session C
└── Pi Session D
```

关系：

```text
Website 1 : N Session
```

用户界面可以显示：

```text
对话
├── 重做首页
├── 修改产品详情页
├── SEO 优化
└── 修复移动端导航
```

但底层这些“对话”就是 Pi Session。

不额外创建：

```text
Conversation
    ↓
Pi Session
```

这种 1:1 空壳映射。

---

# 10. 一个 Website 的所有 Session 默认共享同一个 Workspace

例如：

```text
Website 123
        │
        └── Workspace 123
              ↑
      ┌───────┼───────┐
      │       │       │
 Session A Session B Session C
```

Session A：

```text
重做首页
```

Session B：

```text
修改移动端菜单
```

它们拥有独立：

```text
对话历史
上下文
Compaction
分支
任务
```

但看到的是同一个真实：

```text
Website Workspace
Git
Preview Runtime
```

因此 A 修改完成以后，B 再读取文件时看到的是最新文件。

---

# 11. Workspace 是网站真实状态，Session 是 Agent 认知历史

必须明确：

> **Pi Session 不是 Website Source of Truth。**

Website 当前真实状态永远是：

```text
Workspace Files
Git State
Preview Runtime
Production State
CMS State
```

Pi Session 保存的是：

```text
用户说过什么
Agent 做过什么
Tool Result
Compaction
历史分支
```

因此恢复旧 Session 时：

```text
Restore Pi Session
       +
Read Current Workspace State
       =
Current Agent Context
```

不能因为 Session 三天前说：

```text
index.html 是旧版本
```

就忽略 Workspace 已经发生的变化。

---

# 12. Pi Session 能力直接保留

只要 Pi 能力与产品不冲突，就直接复用。

正式保留：

```text
New Session
Resume / Switch Session
Tree
Fork
Clone
Compaction
Auto Compaction
Branch Summary
Labels
Session Name
Steering
Follow-up
Model Change
Thinking Level
```

不因为“第一版”主动删除成熟能力。

UI 是否第一天暴露全部入口可以逐步实现，但底层能力不要人为阉割。

---

# 13. Tree

Pi Session 原生使用：

```text
id
parentId
```

形成树。

概念：

```text
User
 ↓
Assistant
 ↓
User
 ├───────────┐
 ↓           ↓
Branch A   Branch B
```

Website Agent 直接复用。

用户可以：

> 回到之前某一步，从那里重新继续。

不重新设计历史树。

---

# 14. Fork

Pi `AgentSessionRuntime.fork()` 直接复用。

产品语义：

> 从这里创建新对话。

例如：

```text
Session A
    │
    │ fork
    ↓
Session B
```

新 Session 拥有之前上下文，但后续独立发展。

---

# 15. Clone

Pi 当前 Clone 语义可以通过：

```text
fork(entryId, { position: "at" })
```

实现。

产品语义：

> 复制当前对话 / 基于当前进度创建新对话。

直接复用，不重新实现 Conversation Duplicate。

---

# 16. Compaction

优先直接复用 Pi Compaction。

Pi 已经负责：

```text
Old Context
↓
Summary
+
Recent Context
↓
Continue
```

并与 Session Tree / Branch Summary 结合。

Website Agent 不重新实现一个独立 Compaction 系统。

产品层只增加一层很薄的控制与事件投影：用户手动整理上下文对应
`AgentSession.compact()`，并由 Runtime 在空闲时序列化该维护操作；运行中不创建
`AgentRun`、用户消息或工具调用。Pi 的 `compaction_start/end` 只转换为
`context.compaction.started/completed/failed`，不把 Pi 的 reason、summary 或 token
统计暴露给产品协议。Pi 的自动 Compaction 保持启用。

需要特别区分模型上下文与用户可见历史：模型请求使用 Pi 的 compaction-aware
context，而 Session 历史快照使用 `SessionManager.getBranch()` 的当前活动分支，
只投影 `type: message` 条目并忽略 `type: compaction` 摘要。这样整理上下文后刷新页面，
用户仍能看到完整历史，同时不会把内部摘要当成聊天消息。

如果未来 Website 场景还需要保留：

```text
modifiedFiles
currentRelease
verification state
important website facts
```

优先利用：

```text
custom entry
custom message
compaction details
extension hooks
```

扩展。

---

# 17. Steering 与 Follow-up

用户在 Agent 正在运行时继续说话必须自然。

直接使用 Pi：

## Steering

例如 Agent 正在改页面：

> 等一下，Logo 不要动。

```text
User Message
↓
session.steer()
↓
当前 Tool Turn 完成
↓
下一 Turn 注入新要求
```

## Follow-up

例如：

> 做完以后顺便检查移动端。

```text
session.followUp()
```

不用重新实现队列机制。

---

# 18. Pi Session 作为对话历史 Source of Truth

V1 不再额外复制一套：

```text
message
assistant_message
tool_result
branch
compaction
```

数据库。

Pi Session 自己保存：

```text
message
model change
thinking change
tool result
compaction
branch summary
custom entry
custom message
label
session info
```

如果平台再镜像一次，会造成：

```text
Pi 写成功 / DB 写失败
DB 写成功 / Pi 写失败
双写一致性
重复 migration
```

因此：

> **Pi Session 是 Agent Conversation History 的 Source of Truth。**

平台数据库只保存 Website 与 Session 的业务绑定和索引信息。

---

# 19. V1 Session Persistence

当前成熟的 `pi-coding-agent SessionManager` 仍然采用：

> JSONL Session File。

因此 V1 直接使用。

建议：

```text
/site-data/{websiteId}/agent/sessions/
├── session-a.jsonl
├── session-b.jsonl
└── session-c.jsonl
```

这些文件属于：

> Control Plane / Agent State。

不是 Workspace Container 内的临时文件。

必须进入我们 Tech-03 已经设计好的 OSS Backup 范围。

---

# 20. 平台数据库只保存 Session Index

建议最小表：

```text
website_session

id
website_id
pi_session_id
session_file

title
status

parent_session_id   nullable

created_at
updated_at
last_active_at
```

其中：

```text
title
```

可以缓存 Pi Session Name。

`parent_session_id` 用于产品层快速展示 Fork 关系；真实分支历史仍以 Pi Session 为准。

不建立：

```text
conversation
message
tool_call
```

作为 Pi 历史的重复副本。

---

# 21. AgentRun 保留，但属于 Operational Model

`AgentRun` 与 Session 不同。

Session 是长期对话。

AgentRun 是：

> 一次实际 Agent 执行。

例如：

```text
用户：把首页 Hero 改成科技风
↓
agent_start
↓
read
↓
edit
↓
bash
↓
browser
↓
agent_end
```

这是一个 Run。

第二天用户继续：

```text
按钮再小一点
```

仍是同一 Session，但产生新的 AgentRun。

建议：

```text
agent_run

id
website_id
pi_session_id

trace_id
status

provider
model

started_at
ended_at

input_tokens
output_tokens
cost

error_code
```

AgentRun 用于：

```text
日志
审计
计费
耗时
问题追踪
恢复状态
```

不是 Conversation Source of Truth。

---

# 22. AgentRun 状态

建议：

```text
PENDING
RUNNING
COMPLETED
FAILED
ABORTED
INTERRUPTED
UNKNOWN
```

Pi：

```text
agent_start
```

映射：

```text
RUNNING
```

Pi：

```text
agent_end / agent_settled
```

映射：

```text
COMPLETED / FAILED / ABORTED
```

Agent Service 崩溃：

```text
RUNNING
↓
INTERRUPTED / UNKNOWN
```

---

# 23. 一个重要源码结论：不要基于新的 AgentHarness 做 V1

Pi 当前仓库已经出现新的：

```text
packages/agent/src/harness/
```

并且拥有：

```text
Session abstraction
SessionStorage
Lane
Operation record
Suspended operation
SQLite session backend
```

这些设计非常值得关注。

但在本次审查的 commit 中：

```text
AgentHarness.create()
```

对已有 operation record 的恢复仍会进入：

```text
HarnessNotImplemented("create.restore")
```

并且部分 Harness Hooks / Events 也仍处于未完成状态。

因此：

> **它是值得关注的 Pi 下一代 Durable Harness，但不是我们 V1 的稳定基础。**

V1 使用成熟：

```text
pi-coding-agent
AgentSession
AgentSessionRuntime
SessionManager
```

等 Pi 新 Harness 的 crash restore / persistence 完整成熟后，再评估迁移。

---

# 24. Crash Recovery 的真实边界

V1 可以保证：

```text
Agent Service 重启
↓
重新打开 Pi Session JSONL
↓
恢复历史
↓
重新读取真实 Workspace
↓
继续对话
```

但是第一版不宣称：

> Agent Service 在某个 Tool 执行到 53% 时崩溃，重启以后从同一个机器指令精确继续。

当前真实语义：

```text
Session History
✅ 可恢复

Workspace Files
✅ 持久存在

已完成 Tool Result
✅ Session 中存在

正在执行中的 Tool
⚠️ 可能 UNKNOWN

精确 Mid-turn Resume
❌ V1 不保证
```

恢复后：

```text
检查 Workspace / Git / Process 状态
↓
让 Agent 继续 / 重试
```

即可。

---

# 25. 最重要的源码发现：Pi Coding Tools 可以换远程执行后端

这是本方案最关键的复用点之一。

以前一种直觉方案是：

```text
禁用 Pi read/bash/edit/write

自己写：
workspace_read
workspace_edit
workspace_bash
```

最终不采用。

Pi 当前源码已经专门为核心 Tool 定义了可插拔 Operations。

---

# 26. Read Tool

Pi `read` 已提供：

```text
ReadOperations

readFile()
access()
detectImageMimeType()
```

源码甚至明确说明：

> 可以覆盖这些 Operations，将读取委托给远程系统。

因此我们保留 Pi：

```text
read
```

的：

```text
Tool Name
Schema
Prompt Description
Line Offset
Limit
Truncation
Image Handling
Tool Result Format
```

只替换：

```text
真实 readFile()
```

为：

```text
Workspace Gateway
```

---

# 27. Bash Tool

Pi `bash` 已提供：

```text
BashOperations.exec()
```

支持：

```text
command
cwd
onData
AbortSignal
timeout
env
exitCode
```

这正好对应 Tech-02 的：

```text
process.exec
stream
timeout
cancel
```

因此：

```text
Pi bash
↓
Remote BashOperations
↓
Workspace Gateway
↓
Runner
↓
Workspace Daemon
↓
Workspace Shell
```

Agent Service 本机不执行用户网站 Shell。

---

# 28. Edit Tool

Pi `edit` 已经实现成熟的：

```text
exact replacement
multiple edits
diff
unified patch
line ending
BOM
mutation queue
模型参数兼容
```

它同时暴露：

```text
EditOperations

readFile()
writeFile()
access()
```

所以我们应该：

> 保留 Pi Edit Algorithm，仅替换远程 File Operations。

不要自己重新实现一个 `apply_patch` Coding Tool，除非后续明确需要另一种 Edit 语义。

---

# 29. Write Tool

Pi `write` 同样暴露：

```text
WriteOperations

writeFile()
mkdir()
```

因此也直接接 Workspace Gateway。

---

# 30. 最终基础 Coding Tool

V1 优先复用：

```text
read
bash
edit
write
```

Pi 的 Tool Definition 与 Prompt 语义保持不变。

真实执行全部走：

```text
Remote Operations Adapter
↓
Workspace Gateway
```

这样同时得到：

```text
Pi 成熟 Coding Experience
+
我们的远程 Workspace 隔离
```

---

# 31. grep / find / ls

这些能力可以按实际情况逐步接入。

V1 Agent 已有：

```text
bash
```

可以执行：

```text
rg
find
ls
```

因此不需要为了“Tool 数量完整”立刻实现所有远程 Operations。

后续如果发现：

```text
structured grep/find
```

明显提高 Agent 效率，再接入 Pi 对应 Tool 或实现 Remote Tool。

原则：

> 只补真实有收益的能力。

---

# 32. Tool Path 安全

Pi Tool API 接收：

```text
path
cwd
```

但真正安全边界不能依赖 Agent 输入。

Remote Operations Adapter 必须将路径标准化成：

```text
WorkspaceRelativePath
```

然后 Workspace Gateway 再次验证：

```text
workspaceId
+
path
```

必须位于：

```text
target/
```

或该 Tool 明确允许的资源范围。

禁止：

```text
../../
/etc
/var/run/docker.sock
其他 website workspace
```

即使 Pi 本地 path resolution 有自己的路径处理：

> Gateway 仍然是最终安全边界。

---

# 33. Pi CWD 与真实 Workspace

Pi 的成熟 Session / ResourceLoader 体系需要一个 `cwd`。

但 Website Source 并不在 Agent Service 本地。

因此 V1 采用：

```text
PiProjectContextDir
```

例如：

```text
/site-data/{websiteId}/agent/context/
```

该目录用于：

```text
Pi Session runtime mechanics
AGENTS.md / Context Files
Skills references
Pi project resources
```

它不是：

> Website 源码真实目录。

真实源码始终在：

```text
Workspace Provider
↓
Workspace Container
```

Remote Tool Adapter 将 Pi Tool 的逻辑路径映射到：

```text
Workspace root
```

模型层统一理解当前项目根为：

```text
/workspace
```

不得把 Agent Service Host Path 当成 Website 文件路径语义。

---

# 34. Website Custom Tools

Pi 没有的 Website 特有能力直接使用：

```text
customTools
```

或 Extension：

```text
pi.registerTool()
```

接入。

---

# 35. Browser Tools

这是 Website Agent 核心差异化。

建议：

```text
browser_open
browser_snapshot
browser_screenshot
browser_click
browser_inspect
```

具体能力可逐步实现，但 Browser 必须进入 Agent Tool Layer。

链路：

```text
Pi Agent
↓
Browser Tool
↓
Browser Service
↓
Preview URL
↓
DOM / Screenshot / Console / Network
↓
Tool Result
↓
Pi Agent
```

Browser 不属于 Pi 本地文件 Tool。

---

# 36. Browser Verify

Website Agent 的 Coding Loop：

```text
Understand
↓
Read / Search
↓
Edit
↓
Run
↓
Browser Observe
↓
Fix
↓
Browser Verify
↓
Finish
```

不使用 LangGraph 强行写成固定状态机。

实现方式：

```text
Pi Coding Loop
+
Website System Prompt
+
Extension Policy
+
Run State
```

例如：

```text
file mutated = true
UI related = true
browser verified = false
```

Agent 试图结束时：

```text
Website Policy
↓
提醒 / 阻止完成
↓
继续 Browser Verify
```

---

# 37. Git Tools

Agent 可以通过：

```text
bash git ...
```

完成很多普通操作。

但 Website Agent 后续建议增加高层：

```text
git_status
git_diff
git_commit
git_restore
```

原因不是 Pi 做不到 Shell，而是这些动作和：

```text
AgentRun
Audit
Rollback
Website Snapshot
Publish
```

有业务语义。

因此：

```text
Incidental Git
→ bash

Platform-important Git
→ structured Git Tool
```

---

# 38. CMS Tools

后续 CMS Capability：

```text
cms_list_content
cms_get_content
cms_create_content
cms_update_content
cms_delete_content
```

这些不是通用 Coding Tool。

链路：

```text
Pi
↓
CMS Tool
↓
CMS Capability Interface
↓
PbootCMS Adapter
↓
Production / Workspace CMS
```

未来换 WordPress：

```text
WordPress Adapter
```

Agent Core 不变。

---

# 39. Publish Tool

发布必须是：

```text
publish
```

这种平台高层 Tool。

不能让 Agent：

```text
bash rsync ...
```

绕过 Tech-03 的 Release Pipeline。

正确：

```text
Pi
↓
publish
↓
Release Service
↓
Artifact
↓
OSS
↓
Production Runner
↓
Atomic Switch
↓
Health Check
```

Publish Tool 受产品 Policy 控制。

---

# 40. Pi Extensions 的定位

Website Agent 充分使用 Pi Extensions。

适合实现：

```text
Audit
Tool Policy
Path Protection
Dangerous Operation Gate
Git Checkpoint
Browser Verification State
Publish Preconditions
Website Context Injection
Usage Metrics
```

Pi Extension 已经支持：

```text
Tool Call interception
Tool Result modification
Agent lifecycle
Session lifecycle
Compaction lifecycle
Session persistence
Custom tools
Custom commands
```

因此不要再单独发明第二套 Hook Framework。

---

# 41. 用户确认与危险操作

Pi Extension 可以阻止 Tool Call。

但我们的用户交互在 Web。

因此：

```text
Pi tool_call
↓
Website Policy Extension
↓
requiresApproval
↓
Agent Service Event
↓
Next.js
↓
User Confirm
↓
Resume / Execute
```

不直接依赖 Pi TUI 的：

```text
ctx.ui.confirm()
```

因为最终产品不是 Pi CLI。

---

# 42. System Prompt

不建议第一天完全重写 Pi Coding Prompt。

Pi 当前默认 Prompt 已经会根据：

```text
selectedTools
toolSnippets
promptGuidelines
contextFiles
skills
```

动态生成 Coding 指令。

优先：

```text
Pi Coding Prompt
+
Website Agent Instructions
```

通过：

```text
appendSystemPromptOverride
```

或 ResourceLoader 扩展。

只有 Pi 默认 Prompt 中的内容明显：

```text
破坏产品语义
暴露不合适内部概念
与远程 Workspace 产生冲突
```

才使用：

```text
systemPromptOverride
```

完全替换。

---

# 43. Website Agent Prompt 主要补什么

重点只补 Pi 不知道的部分：

```text
你操作的是 Website Workspace
真实文件操作必须通过 Tools
Preview 与 Production 分离
UI 修改后必须浏览器验证
Publish 必须走 publish Tool
Production DB 是内容真源
CMS Content Operation 与 Code Change 区分
禁止绕过 Gateway
禁止假设本地 Host 就是 Website
```

不要重复教模型：

```text
怎么读文件
怎么调用 bash
怎么 edit
```

Pi 已经解决。

---

# 44. Context Files

Pi 已经支持项目 Context Files，例如：

```text
AGENTS.md
```

Website Agent 应直接兼容。

每个 Website 可拥有：

```text
AGENTS.md
```

里面记录：

```text
网站约束
设计规范
代码约束
用户长期要求
CMS 项目规则
```

这些是：

> Website-level durable instructions。

多个 Session 共享。

---

# 45. Skills

直接兼容 Pi Skills。

例如：

```text
skills/
├── pbootcms/
│   └── SKILL.md
├── frontend-design/
│   └── SKILL.md
├── seo/
│   └── SKILL.md
└── website-debugging/
    └── SKILL.md
```

Pi 已有 Skills 发现与注入能力。

不要重新发明：

```text
Website Plugin Prompt Format
```

---

# 46. Session Custom Entry

Pi 的 Session 支持：

```text
custom
custom_message
```

Website Agent 可以用来保存与 Session 紧密相关的扩展状态。

例如：

```text
website-run-summary
browser-verification
git-checkpoint
publish-result
workspace-revision
```

其中：

```text
custom
```

用于：

> 持久化但不进入 LLM Context。

```text
custom_message
```

用于：

> 需要进入 LLM Context 的 Website 信息。

尽量利用 Pi 已有 Session 机制。

---

# 47. 多 Session 并发问题

一个 Website 有多个 Session，而它们共享同一个 Workspace。

因此：

```text
Session A
Session B
```

可能同时修改：

```text
template/index.html
```

这是必须处理的问题。

---

# 48. V1 使用 Website Mutation Lease

第一版不需要每个 Session 一个 Git Worktree。

先采用：

> **同一个 Website 同一时刻最多一个 Mutating Agent Run。**

例如：

```text
Session A
↓
获取 Mutation Lease
↓
Edit / Bash Mutation
↓
Verify
↓
Release Lease
```

此时 Session B 可以：

```text
读取
查看
聊天
分析
```

但如果也要修改：

```text
WAIT / BUSY
```

或排队。

---

# 49. 为什么不直接锁整个 Session

锁的粒度是：

```text
Website Workspace Mutation
```

不是：

```text
Session
```

因为不同 Session 可以并发：

```text
Read
Reasoning
查看历史
```

只有真实修改 Workspace 时冲突。

---

# 50. 未来真正并行开发

如果以后需要：

```text
Session A 修改首页
Session B 同时修改产品页
```

再升级：

```text
Git Branch
+
Git Worktree
+
Per-session Workspace
+
Merge
```

这属于后续高级 Coding Agent 能力。

V1 不提前增加。

---

# 51. Streaming

Pi 已经提供细粒度事件：

```text
message_start
message_update
message_end

tool_execution_start
tool_execution_update
tool_execution_end

turn_start
turn_end

agent_start
agent_end

queue_update
compaction_start/end
retry
```

Agent Service 直接订阅。

然后：

```text
Pi Events
↓
Agent Event Adapter
↓
SSE / WebSocket
↓
Next.js
↓
UI
```

不要重新解析模型 Provider Streaming。

---

# 52. UI Event Projection

Pi Event 是 Runtime Event。

产品 UI 可以转换成：

```text
assistant_text_delta
thinking_delta
tool_started
tool_progress
tool_finished
agent_status
compaction
approval_required
preview_updated
publish_status
```

这是：

> UI Projection。

不是重新持久化一套 Conversation。

---

# 53. Page Refresh / Reconnect

刷新页面：

```text
Load Pi Session History
+
Load Current AgentRun
+
Reconnect Event Stream
```

如果 Agent 仍在运行：

```text
继续展示实时事件
```

如果连接中断：

```text
重新拉取 Session 最新 Entries
↓
从最新事件序号继续
```

Agent Service 可维护轻量 Event Replay Buffer。

长期历史仍以 Pi Session 为准。

---

# 54. Model Runtime

优先复用 Pi：

```text
ModelRuntime
+
pi-ai
```

Website Agent 不绑定：

```text
Anthropic
OpenAI
Google
```

业务层只配置：

```text
provider
model
thinkingLevel
```

未来可以按套餐：

```text
Fast
Balanced
Best
```

映射到具体模型。

---

# 55. 模型切换

Pi Session 本身支持：

```text
model_change
thinking_level_change
```

直接保留。

用户如果在一个 Session 中切换模型：

```text
Session History
```

仍然连续。

不要重新创建 Session。

---

# 56. Pi 与用户体验的边界

我们复用 Pi 的能力。

但用户不需要知道：

```text
@earendil-works/pi
SessionManager
JSONL
AgentSessionRuntime
ExtensionRunner
```

用户看到的是：

```text
网站
对话
历史分支
从这里新建对话
继续
压缩上下文
停止
模型
工具执行
预览
发布
```

原则：

> 复用实现，不要求用户学习 Pi。

---

# 57. V1 最小 Platform Data Model

建议：

```text
website
```

已有 Website 主实体。

新增：

```text
website_session
agent_run
```

以及 Tech-02 已经需要的：

```text
tool/audit trace
```

不额外建立完整：

```text
message
tool_result
compaction
branch
```

镜像表。

---

# 58. website_session

概念字段：

```text
id
website_id

pi_session_id
session_file

title
status

parent_session_id

created_at
updated_at
last_active_at
```

Pi Session 仍是历史真源。

---

# 59. agent_run

概念字段：

```text
id
website_id
pi_session_id

trace_id
status

provider
model
thinking_level

started_at
ended_at

input_tokens
output_tokens
cache_tokens
cost

error_code
error_message
```

这张表是运行与运营数据。

---

# 60. Tool Audit

Tool 调用审计优先沿用 Tech-02：

```text
traceId
agentRunId
requestId
workspaceId
operation
status
duration
```

不再因为 Pi 增加第二套重复 Audit。

---

# 61. Session 生命周期 API 映射

产品动作与 Pi 映射：

| 产品动作 | Pi 能力 |
|---|---|
| 新建对话 | `AgentSessionRuntime.newSession()` |
| 打开历史对话 | `switchSession()` |
| 继续对话 | 恢复 Session 后 `prompt()` |
| 从历史节点继续 | `navigateTree()` |
| 从这里新建对话 | `fork()` |
| 复制当前对话 | `fork(..., { position: "at" })` |
| 压缩上下文 | `compact()` |
| 中途改变要求 | `steer()` |
| 完成后追加任务 | `followUp()` |
| 停止执行 | `abort()` |
| 切换模型 | `setModel()` |
| 调整思考级别 | `setThinkingLevel()` |

原则：

> 产品 API 优先薄映射，不再实现一套等价状态机。

---

# 62. 一次典型 Website Agent Run

用户：

> 把首页 Hero 改成更有科技感，但不要改 Logo。

流程：

```text
Next.js
↓
Agent Service
↓
Load Website Session
↓
Load Current Website Context
↓
Pi session.prompt()
↓
Pi Agent
↓
read
↓
Remote ReadOperations
↓
Workspace Gateway
↓
读取 template/index.html

↓
edit
↓
Remote EditOperations
↓
修改真实 Workspace

↓
bash
↓
Remote BashOperations
↓
运行检查

↓
browser_open
↓
Preview

↓
browser_snapshot
↓
Agent 观察结果

↓
继续 edit / verify

↓
git_commit

↓
Agent Finish
↓
agent_run COMPLETED
↓
Streaming Final Result
```

Pi 负责 Agent Loop。

Website Agent 不需要人为编排每一步。

---

# 63. Browser Verification 与自由 Agent Loop 的关系

不要写成：

```text
READ_NODE
↓
EDIT_NODE
↓
BROWSER_NODE
↓
FINISH_NODE
```

这种硬编码图。

Coding Agent 的价值正是模型可以：

```text
read
read
bash
edit
browser
edit
read
browser
```

动态决策。

我们只提供：

```text
能力
约束
完成条件
```

不把行为顺序硬编码成 LangGraph。

---

# 64. 为什么 Core 不选 LangGraph

我们的主问题是：

> Coding Agent。

Pi 已经提供成熟 Coding Loop。

LangGraph 擅长：

```text
确定性 Graph Workflow
Checkpointed Workflow
Human-in-loop business flow
```

如果为了 Coding Loop 引入 LangGraph：

```text
LLM Node
Tool Node
LLM Node
Tool Node
```

等于重新搭一遍 Pi。

因此：

> **Agent Core 不使用 LangGraph。**

以后像：

```text
域名接入
复杂 Publish Approval
批量迁移
运营工作流
```

如果真的需要 Graph，再局部引入。

---

# 65. WebsiteAgentRuntime 的职责

虽然 Pi 尽量直接复用，但仍然需要一个很薄的：

```text
WebsiteAgentRuntime
```

它不是第二个 Agent Framework。

职责只有：

```text
websiteId → Workspace
websiteId → Pi Sessions
构造 Pi runtime
注入 Website resources
注入 Remote Operations
注册 Website tools
注册 Website extensions
Event Projection
Mutation Lease
Run metadata
```

---

# 66. PiAgentAdapter

业务代码不要到处：

```text
import @earendil-works/pi-...
```

统一经过：

```text
PiAgentAdapter
```

目的：

```text
隔离 Pi 版本变化
统一构建 Session
统一 Tool 注入
统一 Event 转换
便于测试
未来必要时替换 Engine
```

不是重新包装 Pi 全部 API。

只做薄 Adapter。

---

# 67. 推荐模块结构

```text
apps/
├── web/
│
└── agent-service/
    ├── api/
    ├── streaming/
    └── runtime/

packages/
├── pi-adapter/
│   ├── create-pi-runtime.ts
│   ├── session.ts
│   ├── event-projector.ts
│   └── resources.ts
│
├── website-agent/
│   ├── website-agent-runtime.ts
│   ├── run-manager.ts
│   ├── mutation-lease.ts
│   └── policies/
│
├── workspace-client/
│   ├── filesystem.ts
│   ├── process.ts
│   ├── git.ts
│   └── runtime.ts
│
├── website-tools/
│   ├── remote-read-operations.ts
│   ├── remote-edit-operations.ts
│   ├── remote-write-operations.ts
│   ├── remote-bash-operations.ts
│   ├── browser/
│   ├── git/
│   ├── cms/
│   └── publish/
│
├── cms-pboot/
│
└── shared/
```

目录仅为推荐，不要求机械照搬。

---

# 68. Pi Version Strategy

生产不要使用：

```text
^0.x
latest
```

直接漂移。

采用：

> **锁定一个经过回归测试的 Pi 版本。**

例如当前基线：

```text
0.84.4
```

升级流程：

```text
Pi Release
↓
Review Changelog / Diff
↓
Run Website Agent Regression
↓
Session Compatibility Test
↓
Tool Compatibility Test
↓
Upgrade
```

---

# 69. Pi Regression Test

至少建立：

```text
1. New Session
2. Resume Session
3. Tree Navigation
4. Fork
5. Clone
6. Compact
7. Steering
8. Follow-up
9. Remote Read
10. Remote Edit
11. Remote Write
12. Remote Bash Streaming
13. Abort
14. Browser Tool
15. Session Restore After Process Restart
16. Website Mutation Lease
```

这样 Pi 可以持续升级，但不影响产品稳定性。

---

# 70. Future Pi Migration

重点关注 Pi 新的：

```text
packages/agent/src/harness
packages/session-backends/sqlite-node
```

未来如果：

```text
Durable AgentHarness
Crash Resume
Custom Session Backend
Hooks / Events
```

达到成熟稳定状态，可以评估：

```text
pi-coding-agent legacy SessionManager
↓
new durable Pi Harness
```

但：

> 不为了“未来更先进”提前使用当前未完成路径。

---

# 71. V1 明确不做

V1 不做：

```text
从零 Agent Loop
Fork 整个 Pi
自己重写 Session Tree
自己重写 Fork / Clone
自己重写 Compaction
自己重写 Steering / Follow-up
自己重复保存完整 Message History
LangGraph Coding Loop
每 Session 一个 Workspace
多 Agent 自动协作
复杂 Agent Planner Graph
精确 Mid-tool Crash Resume
```

---

# 72. 后续可以继续增强

不影响当前架构：

```text
Sub-agent
Website Memory
Design Critic Agent
SEO Reviewer
Visual QA
Automatic Regression
Per-session Git Worktree
Parallel Coding Sessions
Durable Agent Harness
Multi-node Agent Service
Model Routing
Evaluation
```

是否增加必须由实际产品收益决定。

---

# 73. Architecture Decisions

## ADR-053

Agent 技术栈采用 TypeScript / Node.js。

## ADR-054

Next.js 负责 Web 产品层，Agent Runtime 使用独立 Node.js Agent Service。

## ADR-055

Website Agent 遵循 Pi-first 原则：符合产品语义的 Pi 能力优先直接复用。

## ADR-056

V1 主要 Agent Runtime 采用 `@earendil-works/pi-coding-agent` 高层 SDK，而不是直接从裸 `pi-agent-core` 重建 Coding Harness。

## ADR-057

V1 不 Fork 整个 Pi；优先 SDK、Extension、Remote Operations、Adapter 和上游 PR。

## ADR-058

一个 Website 可以拥有多个 Pi Session。

## ADR-059

不增加独立 Conversation Domain；用户看到的“对话”直接对应 Pi Session。

## ADR-060

同一 Website 的多个 Session 默认共享同一个 Website Workspace。

## ADR-061

Pi Session 是 Agent 对话历史 Source of Truth；Workspace 是 Website 当前真实状态 Source of Truth。

## ADR-062

Tree / Fork / Clone / Compaction / Steering / Follow-up 等 Pi 能力默认保留并直接复用。

## ADR-063

V1 使用成熟 `pi-coding-agent SessionManager` JSONL 持久化 Session。

## ADR-064

平台数据库只保存 Website ↔ Pi Session 的业务索引，不重复镜像完整 Message / Tool Result / Compaction 数据。

## ADR-065

AgentRun 作为运行、审计、计费和恢复状态对象保留，但不成为 Conversation 层。

## ADR-066

V1 不基于当前仍未完成完整 Restore 的新 Pi `AgentHarness` 构建核心 Runtime。

## ADR-067

Pi 的 `read/bash/edit/write` Tool Definition 优先直接复用，通过 Remote Operations 委托 Workspace Gateway 执行。

## ADR-068

Workspace Gateway 是文件路径、命令执行和资源访问的最终安全边界。

## ADR-069

Browser / CMS / Publish 等 Website 特有能力作为 Pi Custom Tool / Extension 接入。

## ADR-070

Runtime 继续复用 Pi Coding Agent Harness；模型级 System Prompt 由 CloudCrane 完整控制，不继承 Pi 的产品身份与默认 Coding Agent 人格。底层 SDK 的 ResourceLoader 通过官方覆盖接口注入 CloudCrane System Prompt，同时保留工具描述、Skills、AGENTS context 和 Extensions 等运行能力。

## ADR-071

Website Context Files / Skills 优先兼容 Pi 原生机制。

## ADR-072

Website Tool Policy、Audit、Verification 等优先利用 Pi Extension 生命周期实现。

## ADR-073

一个 Website 同一时刻默认只允许一个 Mutating Agent Run，使用 Website Mutation Lease 保护共享 Workspace。

## ADR-074

V1 Crash Recovery 保证 Session 和 Workspace 可恢复，但不保证任意 Mid-tool 精确续跑。

## ADR-075

Agent Core 不使用 LangGraph 重建 Coding Loop。

## ADR-076

Pi 依赖锁定经过验证的精确版本，通过 Adapter 与回归测试控制升级风险。

---

# 74. 最终架构图

```text
                            User
                             │
                             ↓
                       ┌──────────┐
                       │ Next.js  │
                       └────┬─────┘
                            │
                    SSE / WebSocket
                            │
                            ↓
                  ┌───────────────────┐
                  │   Agent Service   │
                  └────────┬──────────┘
                           │
                WebsiteAgentRuntime
                           │
                     PiAgentAdapter
                           │
               ┌───────────┴───────────┐
               │                       │
       Pi AgentSessionRuntime     Website Policy
               │                       │
       ┌───────┼────────┐              │
       │       │        │              │
   Session   Model   Resources      Extensions
   Manager  Runtime  Skills            │
       │       │    Context            │
       │       │                       │
       └───────┴──────────┬────────────┘
                          │
                       Agent Loop
                          │
                          ↓
                         Tools
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
   Pi Coding Tools   Website Tools       Policy
        │                 │                  │
 read/bash/edit/write  Browser/CMS/Git/Publish
        │                 │
        └──────────┬──────┘
                   │
          WorkspaceGatewayClient
                   │
                   ↓
            Workspace Gateway
                   │
                  WSS
                   │
                   ↓
               ECS Runner
                   │
                   ↓
            Workspace Daemon
                   │
                   ↓
             Website Workspace
                   │
            PbootCMS / PHP / Git
                   │
                   ↓
                Preview
```

---

# 75. 核心边界一句话总结

最终我们不是：

> “基于 Pi 做一个换皮 Coding Agent。”

也不是：

> “参考 Pi 后重新做一个 Agent。”

而是：

> **直接把 Pi 作为成熟 Coding Agent Harness 嵌入产品，并把执行环境、Website Tools、CMS、Browser、Publish、Workspace 安全和产品 UI 替换成我们自己的 Website Agent 能力。**

这样最大程度复用 Coding Agent 已经成熟的部分，同时真正把研发资源投入到：

```text
Website Workspace
Browser Verification
CMS-native Operation
Preview
Publish
Long-term Website Maintenance
```

这些才是 Website Coding Agent 的产品价值。

---

# 76. 源码核对参考

本方案基于 Pi：

```text
Repository:
https://github.com/earendil-works/pi

Reviewed Commit:
853a80d26c90a14c1886f0ebb8ffaae133ca2185
```

重点核对文件：

```text
packages/coding-agent/docs/sdk.md
packages/coding-agent/docs/sessions.md
packages/coding-agent/docs/session-format.md
packages/coding-agent/docs/extensions.md

packages/coding-agent/src/core/sdk.ts
packages/coding-agent/src/core/agent-session.ts
packages/coding-agent/src/core/agent-session-runtime.ts
packages/coding-agent/src/core/session-manager.ts
packages/coding-agent/src/core/system-prompt.ts

packages/coding-agent/src/core/tools/read.ts
packages/coding-agent/src/core/tools/bash.ts
packages/coding-agent/src/core/tools/edit.ts
packages/coding-agent/src/core/tools/write.ts

packages/agent/src/harness/agent-harness.ts
packages/agent/src/harness/session/

packages/session-backends/sqlite-node/
```

后续实现前应再次锁定具体 Pi npm 版本和 commit，避免直接跟随 `main` 漂移。
