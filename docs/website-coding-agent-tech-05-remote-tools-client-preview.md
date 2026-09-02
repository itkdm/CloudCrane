# CloudCrane（筑云鹤）技术架构基线 05：Remote Coding Tools 与 Client-assisted Preview

> 文档版本：V0.1  
> 状态：已确认 / Architecture Baseline  
> 更新时间：2026-08-30
>
> 前置文档：
> - `website-coding-agent-product-definition-v0.1.md`
> - `website-coding-agent-tech-01-workspace.md`
> - `website-coding-agent-tech-02-remote-execution-gateway.md`
> - `website-coding-agent-tech-03-preview-production-release-persistence.md`
> - `website-coding-agent-tech-04-agent-runtime-pi.md`
>
> 本文基于 Pi `earendil-works/pi` 当前已核对源码设计。

---

# 1. 本文解决的问题

Tech-04 已经确定：

> Website Agent 使用 Pi Coding Agent 作为成熟 Agent Harness。

本文继续冻结：

1. Pi 的 `read / bash / edit / write / ls / find` 如何真正操作远程 Website Workspace；
2. Agent Service 与 Workspace Gateway 如何连接；
3. 路径、安全、环境变量、并发修改如何处理；
4. Website Preview 如何让用户与 Agent 共享同一个开发页面；
5. Agent 如何获得 Preview DOM、截图和运行时错误；
6. 为什么 V1 不需要服务端常驻 Playwright / Chromium；
7. Headless Browser 在未来架构中的位置。

---

# 2. 核心原则

正式采用两条核心原则。

## 2.1 Coding Tool 复用 Pi，执行后端替换

不是重新实现：

```text
workspace_read
workspace_write
workspace_edit
workspace_bash
```

而是保留 Pi 成熟的：

```text
read
bash
edit
write
ls
find
```

仅替换底层 Operations：

```text
Pi Tool
↓
Remote Operations Adapter
↓
Workspace Gateway
↓
Runner
↓
Workspace Daemon
↓
Website Workspace
```

---

## 2.2 Preview 由用户当前正在看的开发页面提供

开发阶段不默认启动另一套服务端浏览器。

正式采用：

> **Client-assisted Preview**

即：

```text
用户看到的 Preview
=
Agent 观察的 Preview
```

Agent 需要页面验证时，从用户当前的 Preview Client 获取：

```text
DOM
Screenshot
Console Errors
Viewport
Current URL
```

不再默认：

```text
Server Chromium
↓
重新打开同一 Preview
```

---

# 3. Remote Coding Tool 总体架构

```text
                    Pi Agent
                       │
                       ↓
                Pi Coding Tools
                       │
        ┌──────────────┼──────────────┐
        │              │              │
       read           edit           bash
        │              │              │
        └──────────────┼──────────────┘
                       ↓
             Remote Operations Adapter
                       │
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
                  /workspace
```

Agent Service 不直接：

```text
docker exec
ssh
访问 ECS 文件系统
执行用户代码
```

所有 Workspace 访问仍然经过 Tech-02 已确定的 Gateway。

---

# 4. Pi Tool 不重新设计

Pi 已经提供成熟 Tool 语义。

## read

Pi 已经处理：

```text
path
offset
limit
文本截断
图片读取
Tool Result 格式
```

Website Agent 只替换：

```text
readFile
access
detectImageMimeType
```

---

## edit

Pi 已经处理：

```text
精确文本替换
一次多处替换
换行符
BOM
Diff
Unified Patch
模型参数兼容
```

Website Agent 只替换：

```text
readFile
writeFile
access
```

---

## write

Pi 已经处理：

```text
新建文件
覆盖文件
父目录创建
```

Website Agent 只替换：

```text
writeFile
mkdir
```

---

## bash

Pi 已经处理：

```text
command
timeout
AbortSignal
stream output
exitCode
```

Website Agent 只替换：

```text
exec
```

真实命令在 Workspace 内执行。

---

# 5. Pi Logical CWD

Pi 统一认为当前项目根目录为：

```text
/workspace
```

例如：

```text
/workspace/template/default/index.html
```

这是：

> Agent 逻辑路径。

不是 Agent Service 本机网站路径。

真实映射：

```text
Pi Path
/workspace/template/default/index.html

↓ RemotePathMapper

WorkspaceRelativePath
template/default/index.html

↓ Workspace Gateway

workspaceId = ws_123
path = template/default/index.html
```

---

# 6. Agent Service 本地不保存网站源码

Agent Service 本地可以保存：

```text
Pi Session
Pi Context Resources
Website AGENTS.md
Skills metadata
Runtime metadata
```

但不把：

```text
Website target source
```

作为真实源码副本。

网站源码真源仍然在：

```text
Website Workspace
```

这样避免：

```text
Agent Service local state
!=
Workspace state
```

产生双副本问题。

---

# 7. RemotePathMapper

必须有独立：

```text
RemotePathMapper
```

负责：

```text
Pi absolute path
↓
POSIX normalize
↓
确认位于 /workspace
↓
移除 /workspace prefix
↓
WorkspaceRelativePath
```

例如：

```text
/workspace/apps/home/view.html
↓
apps/home/view.html
```

---

# 8. 路径安全

以下路径必须拒绝：

```text
../
../../
/etc
/root
/proc
/sys
/var/run/docker.sock
```

但安全校验不能只放 Agent Service。

必须：

```text
Agent Service
↓
第一次验证

Workspace Gateway
↓
第二次验证

Workspace Daemon
↓
最终受限文件系统
```

最终安全边界是：

> Workspace Gateway + Workspace Container Isolation。

Pi 自己的 Path Resolution 不被视为安全机制。

---

# 9. Read 映射

```text
Pi read
↓
RemoteReadOperations.readFile()
↓
Gateway fs.read
↓
Workspace Daemon
↓
读取 Workspace
```

Gateway 返回：

```text
content
sha256
size
mtime
```

其中：

```text
sha256
```

可被后续 Edit 使用。

---

# 10. Edit 与 optimistic concurrency

Pi Edit 本身：

```text
read
↓
计算 replacement
↓
write
```

远程环境中从 read 到 write 之间文件可能变化。

因此增加：

> **expectedSha256 乐观锁。**

流程：

```text
readFile(path)
↓
sha256 = abc123

Pi Edit Algorithm
↓
newContent

writeFile(
  path,
  content,
  expectedSha256 = abc123
)
```

如果 Workspace Gateway 检测：

```text
Current SHA != abc123
```

返回：

```text
409 FILE_CHANGED
```

Pi Tool 失败。

Agent：

```text
重新 read
↓
重新 edit
```

避免覆盖另一 Session / 人工修改产生的新版本。

---

# 11. Write

新文件：

```text
write
↓
mkdir parent if needed
↓
fs.write
```

覆盖已有文件时同样建议后续支持：

```text
expectedSha256
```

但第一优先是 Edit。

---

# 12. Bash

Pi：

```text
bash({
  command,
  timeout
})
```

映射：

```text
RemoteBashOperations.exec()
↓
Gateway process.exec
↓
Runner
↓
Workspace Daemon
↓
Workspace Shell
```

stdout / stderr：

```text
Workspace
↓
Daemon
↓
Runner
↓
Gateway
↓
Agent Service
↓
Pi onData()
```

保持流式输出。

---

# 13. Bash Abort

Pi 的 AbortSignal：

```text
AbortSignal
↓
RemoteBashOperations
↓
Gateway cancel(requestId)
↓
Runner
↓
Daemon
↓
kill process tree
```

不能只在 Agent Service 停止等待，而让远程命令继续运行。

---

# 14. Bash Environment

禁止：

```text
Agent Service process.env
↓
完整传给 Workspace
```

Agent Service 未来会保存：

```text
Model API Key
OSS Secret
Database Credential
Platform Secret
```

这些不能进入用户 Workspace。

采用：

```text
Pi Env
↓
SafeEnvFilter
↓
Gateway
```

V1 默认只允许必要的非敏感 metadata。

例如可选：

```text
PI_SESSION_ID
PI_MODEL
PI_REASONING_LEVEL
```

Workspace 自己提供：

```text
PATH
HOME
LANG
PHP runtime env
```

---

# 15. ls

Pi 当前 `ls` 已支持：

```text
exists
stat
readdir
```

替换 Operations 后可以直接复用。

链路：

```text
Pi ls
↓
RemoteLsOperations
↓
Gateway fs.list/stat
```

---

# 16. find

Pi 当前 `find` 已支持自定义：

```text
exists
glob
```

存在自定义 `glob()` 时，不必在 Agent Service 本地运行 `fd`。

因此可以直接实现：

```text
RemoteFindOperations
```

由 Workspace：

```text
fd / filesystem search
```

完成。

---

# 17. grep

Pi 当前 `grep` 虽然有部分 Operations 抽象，但主体仍会在 Agent Service 本机启动 `rg`。

这与远程 Workspace 不匹配。

因此 V1：

```text
内容搜索
→ bash + rg
```

即可。

后续可以：

1. 给 Pi 增加完整 Remote Grep Operations；
2. 或提供我们自己的 `grep` Tool；
3. 或向 Pi 上游提交 PR。

不因为一个 grep Tool Fork Pi。

---

# 18. V1 Coding Tool Set

优先：

```text
read
edit
write
bash
ls
find
```

内容搜索：

```text
bash → rg
```

后续根据效果再增加独立 grep。

---

# 19. Tool Audit

所有 Remote Operation 都继续沿用 Tech-02：

```text
traceId
agentRunId
requestId
workspaceId
operation
status
duration
```

Pi Tool 是上层 Coding 语义。

Workspace Gateway Operation 是底层真实执行。

两者通过：

```text
toolCallId
requestId
```

建立关联。

---

# 20. Preview 核心产品形态

Website Agent 的开发 UI：

```text
┌──────────────────────┬───────────────────────────┐
│                      │                           │
│       Agent Chat     │      Website Preview      │
│                      │                           │
│   正在读取...         │                           │
│   正在修改首页...     │     实时显示开发网站       │
│   已完成...           │                           │
│                      │                           │
└──────────────────────┴───────────────────────────┘
```

核心体验：

> **边聊、边改、边看。**

---

# 21. Workspace 改动立即进入 Preview

PbootCMS / PHP 网站开发通常无需复杂 Build Pipeline。

例如：

```text
Agent edit template
↓
Workspace file changed
↓
下一次 HTTP Request
↓
Preview 生效
```

CSS / JS：

```text
写入
↓
刷新 Preview
```

PHP：

```text
写入
↓
下一请求执行新代码
```

因此开发阶段不是：

```text
Edit
↓
Deploy Dev
↓
Preview
```

而是：

```text
Edit Workspace
↓
Refresh Preview
```

---

# 22. Preview 使用 Tech-03 已确定的稳定域名

例如：

```text
site-abc.preview.platform.com
```

流程：

```text
Client
↓
Preview Gateway
↓
Website Workspace Runtime
```

右侧 Preview 始终展示该 URL。

---

# 23. 用户与 Agent 共享同一个 Preview

正式不采用：

```text
用户浏览器看到 Preview A

Agent Server Chromium 打开 Preview B
```

而采用：

```text
同一个 Preview 页面
      │
      ├── User observes
      └── Agent observes
```

这确保：

```text
用户看到什么
Agent 就验证什么
```

避免两个 Browser State 不一致。

---

# 24. Preview Bridge

Preview Runtime 在开发环境注入：

```text
website-agent-preview-bridge.js
```

Production 不注入。

结构：

```text
Next.js App
    │
    │ postMessage
    ↓
Preview iframe
    │
    ↓
Preview Bridge
```

Bridge 是开发环境的受控观察层。

---

# 25. Preview Bridge 能力

V1 建议提供：

```text
current URL
viewport
scroll position

DOM snapshot
visible text
element metadata

console errors
window errors

selected element

refresh
navigate internal path
```

截图由 Client Preview Provider 处理。

---

# 26. DOM Snapshot

Agent 不应该只依赖 Screenshot。

Preview Bridge 应提供结构化页面信息。

例如：

```text
Page: /
Viewport: 1440x900

<header data-agent-ref="e1">
  <img data-agent-ref="e2" ...>
  <nav data-agent-ref="e3">
</header>

<section data-agent-ref="e4" class="hero">
...
</section>
```

目标不是完整复制所有 HTML。

而是提供：

```text
语义结构
文本
重要 attribute
element ref
可见元素
```

控制 Context 大小。

---

# 27. Screenshot

视觉修改需要：

```text
Screenshot
```

用于让支持 Vision 的模型检查：

```text
布局
颜色
间距
遮挡
响应式
视觉效果
```

Agent Observation 最佳形态：

```text
DOM Snapshot
+
Screenshot
+
Console Errors
```

而不是单独 Screenshot。

---

# 28. Client Screenshot

如果 Website Agent 是：

```text
Desktop / Electron
```

优先直接使用客户端真正的页面捕获能力。

例如：

```text
WebContents.capturePage()
```

这样：

```text
用户看到的像素
=
Agent 收到的截图
```

是最理想的体验。

---

# 29. Web Client Screenshot

如果是普通 Browser Web Client：

父页面不能直接读取跨 Origin iframe 的完整像素。

因此不能假设：

```text
html2canvas(parent iframe)
```

总是可用。

Web 版本可以：

1. Preview Bridge 自己执行 DOM Capture；
2. 使用受控同源/代理方案；
3. 或只提供 DOM Snapshot + 用户截图；
4. 后续增加 Headless fallback。

具体实现根据最终 Desktop/Web 产品形态选择。

架构不写死截图技术。

---

# 30. PreviewObservationProvider

正式抽象：

```text
PreviewObservationProvider
```

接口概念：

```text
observe()
screenshot()
getDomSnapshot()
getConsoleErrors()
getViewport()
navigate()
refresh()
```

第一实现：

```text
ClientPreviewProvider
```

未来：

```text
HeadlessPreviewProvider
```

---

# 31. ClientPreviewProvider

默认：

```text
Pi Agent
↓
preview_observe
↓
Agent Service
↓
WebSocket
↓
User Client
↓
Preview Bridge
↓
DOM / Screenshot / Console
↓
Client
↓
Agent Service
↓
Pi
```

---

# 32. Agent Preview Tool

Agent 侧不暴露：

```text
arbitrary browser URL
```

而暴露 Website 语义。

例如：

```text
preview_observe
preview_screenshot
preview_refresh
preview_navigate
preview_select
```

其中：

```text
preview_navigate("/products")
```

由服务端解析：

```text
websiteId
↓
Preview Base URL
↓
https://site-123.preview.xxx.com/products
```

Agent 不直接控制 Host。

---

# 33. Preview Security

Preview Tool 只能访问当前：

```text
Website Preview
```

不能访问：

```text
169.254.*
100.100.100.200
localhost arbitrary service
其他 Workspace
任意公网网站
```

因此：

```text
Agent Tool 输入
=
relative path
```

而不是 arbitrary URL。

---

# 34. Client 与 Agent Service 连接

Agent Service 需要知道：

```text
websiteId
sessionId
clientId
previewCapabilities
```

客户端进入某 Website Workbench 并建立 WebSocket 后注册 Browser Client：

```text
preview.client.register
```

注册只表示当前 Browser Tab 可以接收 `preview.request`，不要求 Preview iframe 已打开，也不要求 Bridge 已 ready。Bridge 建立后再发送 `preview.client.capabilities` 更新；关闭 Preview 时清除能力，但不注销 Browser Client。

能力例如：

```text
DOM_SNAPSHOT
SCREENSHOT
CONSOLE
ELEMENT_SELECT
```

Agent 需要 Observation 时使用触发本次 AgentRun 的 Browser Client。

---

# 35. 多个 Client

同一 Website 未来可能被多个 Client 打开。

V1 可以简单规定：

```text
Active Preview Client
=
当前触发 AgentRun 的 Client
```

避免随机选择别人的页面状态。

如果该 Client 断开：

```text
Preview Observation
→ CLIENT_UNAVAILABLE
```

Agent 可以：

```text
继续非视觉任务
```

或提示用户保持页面打开。

未来再用 Headless Provider fallback。

---

# 36. Preview Observation Timeout

例如：

```text
preview_observe
↓
REQUEST_CLIENT_OBSERVATION
↓
observe 默认约 20s timeout；refresh / navigate 默认约 25s timeout
```

如果 Client 无响应：

```text
CLIENT_PREVIEW_TIMEOUT
```

不能无限等待。

---

# 37. Preview Refresh

Agent 修改文件成功以后，可以发送：

```text
PREVIEW_REFRESH
```

当前 Client：

```text
iframe reload
```

然后：

```text
wait load
↓
collect DOM
↓
collect console
↓
capture screenshot
```

形成自然闭环。

---

# 38. Website Agent Visual Loop

最终：

```text
User Request
↓
Pi
↓
read
↓
edit
↓
bash
↓
preview_refresh
↓
preview_observe
↓
DOM + Screenshot + Console
↓
Pi
↓
判断
├── 不满意 → edit
└── 满意 → Finish
```

这就是 Website Agent 最重要的开发循环。

---

# 39. Element Select

后续非常有价值，建议架构现在保留。

用户可以在 Preview：

```text
点击一个元素
```

Preview Bridge 返回：

```text
element ref
tag
id
class
text
DOM path
bounding rect
nearby DOM
cropped screenshot
```

然后用户说：

> 把这里改得更简洁。

Agent 收到：

```text
User Prompt
+
Selected Element Context
```

可以精准修改。

---

# 40. Visual Editing 产品形态

长期可以形成：

```text
Chat
+
Live Preview
+
Element Select
+
Agent Coding
```

这是 Website Coding Agent 与普通 CLI Coding Agent 的核心差异之一。

---

# 41. Production 不默认运行 Browser Agent

正常发布：

```text
Workspace
↓
Preview
↓
Agent Verify
↓
User Confirm
↓
Publish
↓
Production
```

Production 第一层验证：

```text
HTTP Health Check
Release Health
PHP Runtime Check
```

不默认：

```text
启动 Chromium
↓
重新做完整视觉测试
```

节省资源。

---

# 42. HeadlessPreviewProvider

未来只作为：

> Fallback / Background Agent Capability。

适用：

```text
用户关闭页面
Agent 后台继续长任务

定时 Visual Regression

Production Visual Check

CI-like website verification
```

实现可以考虑：

```text
Playwright
Playwright MCP
Browser Service
```

但不是 V1 主路径。

---

# 43. 为什么 V1 不常驻 Chromium

当前资源：

```text
2C4G ECS
```

系统还需要：

```text
Platform
Agent Service
Runner
Workspace Containers
Production Containers
```

Chromium 是明显的额外内存消费者。

而用户本来已经打开 Preview。

因此：

> V1 不为同一个页面再维护一份服务端 Browser State。

---

# 44. Preview Bridge 不进入 Production

开发 Runtime：

```text
Preview Bridge
✅
```

Production Runtime：

```text
Preview Bridge
❌
```

避免：

```text
额外攻击面
调试 API 泄露
DOM inspection bridge 被正式用户访问
```

---

# 45. Session 与 Preview

Pi Session 与 Preview Browser State 不做长期绑定。

因为：

```text
Session
=
长期 Agent History

Preview Client
=
临时 UI Runtime
```

用户关闭客户端：

```text
Session 仍存在
Workspace 仍存在
```

Preview Browser State 可以丢失。

下次打开：

```text
重新加载 Preview
```

即可。

---

# 46. Preview 与 Workspace Source of Truth

仍然遵循：

```text
Workspace
=
代码真实状态

Preview
=
Workspace 当前运行结果

Pi Session
=
Agent 历史与认知
```

任何 Preview Observation 都必须被视为：

> 当前页面运行结果。

而不是 Website 数据真源。

---

# 47. Mutating Agent Run

Tech-04 已确定：

> 同一 Website 默认只有一个 Mutating Agent Run。

因此：

```text
Session A
↓
edit
↓
Mutation Lease
```

此时另一个 Session 仍可以：

```text
read
观察 Preview
聊天
```

但不能同时写入同一 Workspace。

Preview Observation 本身不需要 Mutation Lease。

---

# 48. Error Categories

Remote Coding Tool 统一错误：

```text
WORKSPACE_NOT_FOUND
PATH_OUT_OF_SCOPE
FILE_NOT_FOUND
FILE_CHANGED
PERMISSION_DENIED
PROCESS_TIMEOUT
PROCESS_ABORTED
WORKSPACE_UNAVAILABLE
OUTPUT_TRUNCATED
```

Preview：

```text
PREVIEW_CLIENT_UNAVAILABLE
PREVIEW_TIMEOUT
PREVIEW_LOAD_FAILED
PREVIEW_BRIDGE_UNAVAILABLE
PREVIEW_SCREENSHOT_FAILED
```

Agent 可以根据结构化错误继续处理。

---

# 49. V1 Tool Set 最终建议

## Coding

```text
read
edit
write
bash
ls
find
```

## Preview

```text
preview_refresh
preview_navigate
preview_observe
preview_screenshot
```

## 后续

```text
preview_select_element
git_status
git_diff
git_commit
cms_*
publish
```

仍遵循：

> 能复用 Pi 就不重复开发。

---

# 50. V1 不做

第一版不做：

```text
Agent Service 本地网站源码副本
SSH 作为正式 Coding Tool 通道
Agent 直接 docker exec
Agent 获取 Docker socket
自己重新设计 read/edit/write/bash
服务端常驻 Chromium
每 Website 一个 Browser Container
Production 默认视觉 Browser Verify
任意 URL Browser Tool
完整 Playwright API 暴露给 Agent
多 Client Browser State 同步
```

---

# 51. Architecture Decisions

## ADR-077

Pi Coding Tools 保留原有语义，通过 Remote Operations Adapter 接入 Workspace Gateway。

## ADR-078

Pi 的逻辑项目根固定为 `/workspace`，Agent Service 本地路径不代表 Website Source Path。

## ADR-079

RemotePathMapper 将 Pi Path 转换为 Workspace-relative POSIX Path。

## ADR-080

Workspace Gateway 是远程文件和命令执行的最终安全边界。

## ADR-081

Pi `edit` 与远程 `fs.write` 使用 `expectedSha256` 乐观并发控制。

## ADR-082

Agent Service 的环境变量不得完整传入 Workspace Shell。

## ADR-083

V1 直接复用 Pi `read/edit/write/bash/ls/find`；grep 内容搜索优先使用 `bash + rg`。

## ADR-084

Website Agent 开发体验采用 Live Preview：修改 Workspace 后刷新 Preview，而不是单独 Dev Deploy。

## ADR-085

开发阶段默认采用 Client-assisted Preview，用户与 Agent 观察同一个 Preview 页面。

## ADR-086

Preview Runtime 注入 Preview Bridge，Production Runtime 不注入。

## ADR-087

Agent Preview Observation 优先同时获取 DOM Snapshot、Screenshot 与 Console Errors。

## ADR-088

Preview Tool 使用 Website-relative path，不允许 Agent 直接指定任意 URL。

## ADR-089

Preview Observation 抽象为 `PreviewObservationProvider`。

## ADR-090

V1 默认实现 `ClientPreviewProvider`；`HeadlessPreviewProvider` 仅作为未来 fallback。

## ADR-091

V1 不部署常驻服务端 Chromium / Playwright Browser Service 作为核心依赖。

## ADR-092

默认使用触发当前 AgentRun 的 Browser Workbench Client 作为 Active Preview Client；Browser Client 注册不依赖 Preview Pane 或 Bridge 是否 ready。

## ADR-093

Preview Browser State 是临时 UI 状态，不作为 Pi Session 或 Website 的持久状态。

---

# 52. 最终架构

```text
                         User
                          │
                          ↓
                    Next.js / Desktop
                          │
          ┌───────────────┴────────────────┐
          │                                │
      Agent Chat                     Live Preview
          │                                │
          │                          Preview Bridge
          │                                │
          │                       DOM / Screenshot
          │                       Console / Viewport
          │                                │
          └───────────────┬────────────────┘
                          │
                          ↓
                    Agent Service
                          │
                       Pi Agent
                          │
              ┌───────────┴────────────┐
              │                        │
       Pi Coding Tools            Preview Tools
              │                        │
       Remote Operations        ClientPreviewProvider
              │                        │
              ↓                        │
      Workspace Gateway                │
              │                        │
              ↓                        │
          ECS Runner                   │
              │                        │
              ↓                        │
       Workspace Daemon                │
              │                        │
              ↓                        │
      Website Workspace ───────────────┘
              │
              ↓
         Preview Runtime
```

---

# 53. 核心闭环

```text
User
↓
Agent
↓
Read
↓
Edit
↓
Run
↓
Refresh Preview
↓
Observe DOM + Screenshot + Console
↓
Fix
↓
Verify
↓
Commit
↓
Publish
```

其中：

```text
Coding Agent Engine
→ Pi

Coding Tool Semantics
→ Pi

Remote Execution
→ Website Platform

Visual Observation
→ User Client Preview

CMS / Publish
→ Website Platform
```

这就是当前 Website Coding Agent 的 V1 核心执行模型。
