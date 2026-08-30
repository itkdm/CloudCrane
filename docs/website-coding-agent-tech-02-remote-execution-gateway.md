# CloudCrane（筑云鹤）技术架构基线 02：Remote Execution & Workspace Gateway

> 文档版本：V0.1  
> 状态：已确认 / Architecture Baseline  
> 前置文档：`Website Coding Agent 技术架构基线 01：Website Workspace`  
> 当前基础设施：阿里云 ECS + Docker  
> 当前 CMS Runtime：PbootCMS  
> 长期演进方向：Agent Sandbox / MicroVM Sandbox  
> 本文范围：Agent 如何远程、安全、稳定地操作 Website Workspace

---

# 1. 本文解决的问题

第一份技术文档已经确定：

```text
阿里云 ECS
    ↓
Docker
    ↓
Website Workspace
```

本文继续确定下面这一层：

```text
User
 ↓
Website Agent
 ↓
Workspace Gateway
 ↓
ECS Runner
 ↓
Workspace Daemon
 ↓
Docker Workspace
```

主要解决：

- Agent 服务运行在哪里；
- Agent 如何找到某个 Workspace；
- Agent 如何读取、搜索、修改文件；
- Agent 如何执行 Shell；
- 长任务和日志如何返回；
- Git 如何操作；
- 谁拥有 Docker 权限；
- Workspace 是否需要暴露端口；
- Gateway、Runner、Daemon 分别负责什么；
- 如何做鉴权、超时、审计、幂等；
- 如何避免第一版架构绑死 Docker；
- 后续切换 ACS Agent Sandbox 时怎么保持上层不变。

---

# 2. 调研结论

本轮重点参考了以下成熟实现：

- Coder Agents / Coder Workspace Daemon
- Daytona Control Plane / Runner / Sandbox Daemon
- OpenHands Runtime / Action Executor
- E2B Sandbox / envd
- GitHub Codespaces 生命周期设计
- Google Cloud Workstations
- AWS CodeCatalyst Dev Environments
- Microsoft Dev Box
- 阿里云 ACS Agent Sandbox

这些项目虽然具体实现不同，但核心思想高度一致。

## 2.1 共识一：Agent Loop 在控制面，不在 Workspace

Coder 的公开架构中：

```text
Control Plane
├── Agent Loop
├── Chat State
├── User Identity
├── LLM Credentials
└── Tool Dispatch

Workspace
├── Files
├── Shell
├── Git
└── Build / Runtime
```

LLM Provider 不直接访问 Workspace。

Workspace 也不需要知道 AI 的存在。

这一点适合我们。

---

## 2.2 共识二：真实执行发生在隔离 Workspace 内

OpenHands 使用：

```text
Backend
 ↓ REST
Action Execution Server
 ↓
Docker Runtime
```

Daytona 使用：

```text
Control Plane
 ↓
Runner
 ↓
Sandbox Daemon
 ↓
Sandbox
```

E2B 同样在 Sandbox 内运行 `envd`：

> Daemon that runs inside a sandbox that allows interacting with the sandbox via calls from the SDK.

因此我们不应该让模型直接操作宿主机。

---

## 2.3 共识三：文件操作应该优先使用结构化 API

Daytona 将：

```text
fs
process
git
pty
```

拆成独立能力。

E2B 对 Agent 暴露：

```text
sandbox.files
sandbox.commands
sandbox.pty
sandbox.git
```

而不是所有操作都包装成：

```bash
cat
sed
grep
echo >
```

结构化 API 更适合：

- 权限控制；
- 参数校验；
- 审计；
- 错误处理；
- 大文件限制；
- 并发控制；
- Provider 替换。

---

## 2.4 共识四：Workspace 不应该公开额外管理端口

Coder 的 Workspace Daemon 主动建立到 Control Plane 的连接。

Workspace 不需要暴露入站管理端口。

对于我们的 ECS + Docker 模式，可以进一步简化为：

```text
Internet
    X
    │
Workspace Daemon
```

Daemon 不公开公网端口。

Runner 在 ECS 本机通过本地接口访问 Daemon。

---

## 2.5 共识五：Control Plane 与 Compute Plane 分开

Daytona：

```text
Control Plane
↓
Compute Plane
```

Google Cloud Workstations：

```text
Controller
+
Gateway
↓
Workstation
```

E2B：

```text
Control Plane
↓
Orchestrator / Compute
↓
MicroVM
```

因此我们的 Gateway 不应该直接承担 Docker 生命周期管理。

---

## 2.6 共识六：Runtime 与 Persistent State 分离

AWS CodeCatalyst、GitHub Codespaces、Google Cloud Workstations 都强调：

```text
Compute 可以 Stop / Rebuild
Persistent Data 继续存在
```

这与我们第一份文档中：

```text
Container = Compute
Volume = Workspace State
```

保持一致。

---

# 3. 正式架构

最终采用：

```text
                         Website Platform
                                │
                    ┌───────────┴───────────┐
                    │                       │
                User/API               LLM Provider
                    │                       │
                    ↓                       │
              Website Agent ────────────────┘
                    │
                    ↓
           ┌────────────────────┐
           │ Workspace Gateway  │
           └─────────┬──────────┘
                     │
              Outbound Channel
                     │
           ┌─────────▼──────────┐
           │     ECS Runner     │
           └─────────┬──────────┘
                     │
               Docker Engine
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
  Workspace A   Workspace B   Workspace C
        │
        ├── Workspace Daemon
        ├── PHP
        ├── Nginx / Web Runtime
        ├── Git
        ├── SQLite / MySQL Client
        ├── PbootCMS
        └── /workspace
```

---

# 4. 三个核心组件

# 4.1 Workspace Gateway

Workspace Gateway 属于平台 Control Plane。

它负责：

```text
Authentication
Authorization
Workspace Routing
Tool Dispatch
Timeout
Audit
Tracing
Request State
Provider Selection
```

Agent 永远通过 Gateway 操作 Workspace。

Agent 不应该知道：

- ECS IP；
- Docker Container ID；
- Docker Socket；
- Runner IP；
- Daemon Port；
- SSH Account。

Agent 只知道：

```text
workspaceId
+
Tool
+
Arguments
```

例如：

```text
readFile(
  workspaceId,
  "/workspace/target/template/default/html/index.html"
)
```

---

# 4.2 ECS Runner

每台 ECS 运行一个可信的 Host Runner。

Runner 是 ECS 上唯一允许拥有 Docker 管理权限的业务组件。

Runner 负责：

```text
create workspace container
start container
stop container
restart container
destroy container

mount persistent volume

allocate CPU
allocate memory
allocate process limits

discover daemon endpoint
discover preview endpoint

health check
heartbeat
container status
```

Runner 可以访问：

```text
Docker Engine / Docker Socket
```

但是：

> Workspace、Agent、PbootCMS 都不能访问 Docker Socket。

这是第一版就必须坚持的安全边界。

---

# 4.3 Workspace Daemon

每个 Workspace Container 内运行一个轻量 Daemon。

它类似：

- Daytona Sandbox Daemon；
- E2B envd；
- OpenHands Action Executor；
- Coder Workspace Daemon。

Daemon 负责 Workspace 内真正的执行能力：

```text
Filesystem
Search
Process
Shell
Git
Runtime Info
Logs
PTY（后续）
```

它不负责：

- 用户登录；
- LLM；
- Chat；
- Workspace 调度；
- Docker；
- ECS；
- 跨 Workspace 权限。

---

# 5. Agent Loop 放在哪里

正式确定：

> Agent Loop 运行在 Website Platform Control Plane。

而不是运行在 Workspace Container。

关系：

```text
User Prompt
    ↓
Agent Loop
    ↓
LLM Provider
    ↓
Tool Call
    ↓
Workspace Gateway
    ↓
Workspace
    ↓
Tool Result
    ↓
Agent Loop
    ↓
LLM Provider
```

这样做的好处：

### LLM Secret 不进入 Workspace

OpenAI / Anthropic / 其他模型的 API Key 只存在于 Control Plane。

网站代码、恶意依赖或 Agent 执行的 Shell 无法直接读取模型密钥。

### Chat State 不依赖 Workspace

聊天记录、Token、Agent Run、Tool Call 都保存到平台数据库。

Workspace Stop / Rebuild 不影响 Agent 历史。

### 后续可替换 Workspace

同一条 Agent Conversation 可以继续操作：

```text
Docker Workspace
```

未来也可以迁移到：

```text
Agent Sandbox Workspace
```

---

# 6. Gateway 与 Runner 的连接

## 6.1 不采用 Agent SSH ECS

正式不采用：

```text
Agent
 ↓
SSH ECS
 ↓
docker exec
```

作为产品正式执行链路。

SSH 只用于内部运维和 Debug。

---

## 6.2 Runner 主动连接 Gateway

采用：

```text
ECS Runner
    │
    │ outbound
    ↓
Workspace Gateway
```

而不是 Gateway 主动开放连接到 ECS Runner。

第一版推荐：

```text
WSS / Persistent WebSocket
```

连接：

```text
Runner ───────── WSS ───────── Gateway
```

原因：

- 实现简单；
- NAT / 安全组友好；
- 不需要 ECS 开管理入站端口；
- 支持双向消息；
- 支持 stdout/stderr 流；
- 支持 Heartbeat；
- 支持多操作复用；
- 后续可以升级成 gRPC Bidi Stream 或更完整 Tunnel。

协议属于内部实现，可以演进。

真正稳定的产品接口是：

```text
Workspace Capability API
```

而不是 WebSocket 本身。

---

# 7. Runner 注册与心跳

Runner 启动后注册：

```json
{
  "type": "runner.register",
  "runnerId": "runner-cn-hangzhou-001",
  "version": "0.1.0",
  "region": "cn-hangzhou",
  "capabilities": [
    "docker",
    "workspace.create",
    "workspace.start",
    "workspace.stop"
  ],
  "resources": {
    "cpuTotal": 8,
    "memoryMbTotal": 16384
  }
}
```

Gateway 保存：

```text
runnerId
region
status
lastHeartbeat
cpu
memory
workspaceCount
version
```

Runner 周期发送 Heartbeat。

Gateway 根据 Heartbeat 判断：

```text
ONLINE
DEGRADED
OFFLINE
```

---

# 8. Workspace Routing

Control Plane 需要维护：

```text
workspaceId
 ↓
runnerId
 ↓
containerId
```

例如：

```text
workspace_123
→ runner_003
→ container_a912...
```

Agent 从不接触这些内部映射。

Gateway 收到：

```text
workspaceId=workspace_123
```

后：

```text
1. Auth
2. Permission
3. Resolve Workspace
4. Resolve Runner
5. Dispatch
```

---

# 9. Gateway → Runner 消息模型

统一使用：

```json
{
  "requestId": "req_xxx",
  "traceId": "trace_xxx",
  "agentRunId": "run_xxx",
  "workspaceId": "ws_xxx",
  "operation": "fs.read",
  "deadlineMs": 30000,
  "payload": {}
}
```

Runner 返回事件：

```text
accepted
stream
completed
error
```

例如：

```json
{
  "requestId": "req_xxx",
  "type": "completed",
  "result": {},
  "durationMs": 21
}
```

---

# 10. 幂等与重试

每一次 Tool Call 都必须拥有：

```text
requestId
```

生命周期操作额外支持：

```text
idempotencyKey
```

例如：

```text
createWorkspace
stopWorkspace
startWorkspace
```

可以安全重试。

但是对于：

```text
shell.exec
file.write
database mutation
```

如果发生：

```text
Runner 已经执行
但是 Gateway 在返回结果前断线
```

不能简单自动再次执行。

因此原则：

> 不确定是否已经执行成功的 Mutation 默认不自动重试。

后续可通过：

```text
operationId
+
Runner execution cache
```

实现更强的幂等。

---

# 11. Runner 与 Workspace Daemon

Runner 发现目标 Container 后，通过仅宿主机可访问的本地端点调用 Workspace Daemon。

第一版建议：

```text
Container Daemon :7070
       ↓
Docker publish
       ↓
127.0.0.1:{randomPort}
```

例如：

```text
127.0.0.1:32145 → container:7070
```

特点：

- Internet 无法访问；
- ECS 安全组无需开放；
- 其他机器无法访问；
- Workspace Gateway 不直接访问；
- 只有 ECS Host Runner 使用。

后续也可以改成 Unix Domain Socket。

该细节不应该泄漏到 Gateway API。

---

# 12. Daemon API

第一版定义 `v1` API。

---

## 12.1 Health / Runtime

```text
GET /v1/health
GET /v1/runtime/info
```

返回：

```text
daemonVersion
workspaceId
runtimeVersion
phpVersion
gitVersion
workingDirectory
uptime
```

---

# 13. Filesystem API

正式不建议 Agent 大量通过 Shell：

```bash
cat
echo
sed
find
grep
```

实现文件操作。

优先使用结构化 API。

---

## 13.1 Read

```text
POST /v1/fs/read
```

请求：

```json
{
  "path": "/workspace/target/index.php",
  "startLine": 1,
  "endLine": 200
}
```

返回：

```json
{
  "content": "...",
  "sha256": "...",
  "size": 1234,
  "truncated": false
}
```

支持：

- 全文件；
- 行范围；
- 大文件截断；
- Hash。

---

## 13.2 Write

```text
POST /v1/fs/write
```

请求建议带：

```text
expectedSha256
```

例如：

```json
{
  "path": "/workspace/target/index.php",
  "content": "...",
  "expectedSha256": "old_hash"
}
```

如果文件已经被其他操作修改：

```text
409 FILE_CHANGED
```

避免 Agent 覆盖别人刚修改的文件。

这是后续多人协作非常重要的基础。

---

## 13.3 List

```text
POST /v1/fs/list
```

---

## 13.4 Search

```text
POST /v1/fs/search
```

参数：

```text
path
query
glob
caseSensitive
maxResults
```

Daemon 内部第一版可以直接使用：

```text
ripgrep
```

但 Agent 不需要知道底层实现。

---

## 13.5 Apply Patch

Coding Agent 修改文件时建议增加：

```text
POST /v1/fs/apply-patch
```

支持：

```text
Unified Diff
```

这样 Agent 可以进行局部修改，而不是频繁整体覆盖大文件。

---

## 13.6 其他文件能力

第一版支持：

```text
mkdir
remove
move
stat
```

后续：

```text
upload
download
stream
permissions
```

---

# 14. 为什么 File API 和 Shell 要分开

例如删除文件：

Shell：

```bash
rm -rf "$path"
```

存在：

- Shell Injection；
- 参数转义；
- 审计粒度差；
- 错误语义差。

结构化：

```text
fs.remove(path)
```

Gateway 可以直接记录：

```text
User A
删除
/workspace/target/static/a.png
```

因此：

> 有明确语义的操作尽量使用结构化 Tool。

Shell 留给真正需要 Shell 的工作。

---

# 15. Process / Shell API

Shell 仍然是 Coding Agent 必不可少的能力。

---

## 15.1 短命令

```text
POST /v1/process/exec
```

请求：

```json
{
  "command": "php -v",
  "cwd": "/workspace/target",
  "env": {},
  "timeoutMs": 30000
}
```

返回：

```json
{
  "exitCode": 0,
  "stdout": "...",
  "stderr": "...",
  "durationMs": 120,
  "truncated": false
}
```

必须支持：

```text
timeout
output size limit
cwd
env
exit code
stdout
stderr
```

---

# 16. 长任务

不能让：

```text
npm install
php server
build
long test
```

永远占着一个同步 HTTP 请求。

增加：

```text
POST /v1/process/start
```

返回：

```text
processId
```

然后：

```text
GET /v1/process/{processId}
GET /v1/process/{processId}/logs
POST /v1/process/{processId}/kill
```

日志使用：

```text
cursor
```

支持断线续读。

---

# 17. stdout / stderr Streaming

Gateway ↔ Runner 的 WSS 通道可以发送：

```text
process.stdout
process.stderr
```

事件。

例如：

```json
{
  "requestId": "req_123",
  "type": "stream",
  "stream": "stdout",
  "seq": 18,
  "data": "..."
}
```

好处：

- Agent 可以及时判断；
- UI 可以显示执行过程；
- 长任务不需要等待结束；
- 后续方便接 Terminal UI。

---

# 18. PTY

PTY 不是第一版 Agent Coding Loop 的必须能力。

但协议预留：

```text
pty.create
pty.input
pty.resize
pty.close
```

Daytona、E2B 都把 PTY 作为独立能力。

后续如果提供：

```text
Web Terminal
REPL
Interactive CLI
```

可以直接增加。

第一版优先：

```text
process.exec
process.start
```

---

# 19. Git API

建议第一版提供结构化 Git Tool：

```text
git.status
git.diff
git.log
git.commit
git.restore
```

底层仍然可以执行：

```bash
git ...
```

但 Agent 调用的是结构化接口。

原因：

- 审计更清晰；
- 返回结构稳定；
- 后续 Git 权限可独立控制；
- 更容易做自动 Snapshot / Commit。

第一版暂时不必须支持：

```text
push
pull
remote credential management
```

这些后续单独设计。

---

# 20. Database

数据库第一版暂时不定义完整 Database API。

PbootCMS MVP 可以：

```text
process.exec
```

执行：

```text
sqlite3
php script
mysql client
```

但长期应该增加：

```text
database.query
database.mutate
cms.*
```

原因：

直接 SQL 很难实现未来：

- Role；
- Approval；
- Audit；
- CMS Adapter；
- WordPress。

因此：

> Raw SQL 是 MVP 过渡能力，不是长期核心协议。

---

# 21. Agent 的系统权限

这里正式做一个调整。

第一版虽然 Owner 可以拥有“完整网站操作权限”，但：

> 不等于 Agent 获得 Container Root。

第一版 Shell 默认使用：

```text
workspace
```

非 root 用户。

该用户拥有：

```text
/workspace
```

完整读写权限。

但默认没有：

```text
Docker Socket
Host FS
Host Network
ECS Metadata
Kernel Capability
```

这样不影响：

- PHP；
- PbootCMS；
- HTML；
- CSS；
- JS；
- SQLite；
- Git；

绝大多数官网开发操作。

需要系统级安装依赖时，后续单独设计：

```text
Package Capability
```

或者重建 Workspace Image。

---

# 22. Container 安全基线

第一版就应该做到：

```text
privileged = false
hostNetwork = false
hostPID = false
hostIPC = false
docker.sock = NOT mounted
```

同时：

```text
CPU limit
Memory limit
PID limit
Disk quota / monitoring
```

后续进一步：

```text
drop capabilities
no-new-privileges
read-only rootfs
seccomp
AppArmor
```

---

# 23. Workspace 网络

长期必须将 Workspace 内代码视为：

> Untrusted Workload。

这一点与阿里云 ACS Agent Sandbox 的官方安全模型一致。

第一版建议：

```text
一个 Workspace
=
一个独立 Docker Network
```

避免 Workspace 直接与其他 Workspace Container 共享业务网络。

至少阻止：

```text
访问其他 Workspace
访问 Docker daemon
访问 ECS metadata
```

ECS Metadata：

```text
100.100.100.200
```

应明确阻断。

阿里 ACS Agent Sandbox 官方同样把 Metadata 服务访问列为必须重点阻断的风险。

公网访问第一版可以按需允许，后续增加：

```text
Domain Allowlist
L4/L7 Egress Policy
```

---

# 24. Secret 原则

任何平台级 Secret：

```text
LLM API Key
Aliyun AccessKey
Platform DB Password
Runner Credential
```

不得放进 Website Workspace。

Workspace 只获得完成网站工作所必需的最小临时凭据。

后续 Git、OSS、Deploy 凭据应采用：

```text
Short-lived Token
```

而不是永久 Secret 写入：

```text
.env
```

---

# 25. Audit

每个 Gateway Tool Call 生成 Audit Record。

例如：

```text
tool_call

id
workspace_id
agent_run_id
user_id
operation
resource
request_time
finish_time
status
duration
request_summary
result_summary
trace_id
```

状态：

```text
PENDING
RUNNING
SUCCESS
FAILED
TIMEOUT
CANCELLED
UNKNOWN
```

`UNKNOWN` 非常重要。

例如：

```text
Runner 已执行 mutation
↓
连接断开
↓
Gateway 不知道执行结果
```

不能错误记录为 FAILED 并自动重试。

---

# 26. Trace

统一：

```text
traceId
agentRunId
requestId
```

链路：

```text
User
 ↓ traceId
Agent Run
 ↓
Gateway
 ↓
Runner
 ↓
Daemon
 ↓
Command
```

以后排查：

> “为什么 Agent 把首页改坏了？”

可以完整找到：

```text
Prompt
Tool Call
File Change
Shell
Git Diff
Commit
```

---

# 27. Control Plane 数据

建议至少维护：

```text
users

websites

workspaces
├── id
├── website_id
├── provider
├── status
├── runner_id
└── runtime_version

runners
├── id
├── region
├── status
├── version
├── cpu
└── memory

agent_runs

tool_calls
```

未来：

```text
workspace_snapshots
workspace_permissions
approvals
deployments
```

---

# 28. Preview 不走 Workspace Gateway Tool Channel

这是一个重要架构决策。

不要：

```text
Browser
 ↓
Gateway
 ↓
Runner Command Channel
 ↓
Website HTTP
```

Preview 网站流量应拥有独立：

```text
Preview Proxy
```

概念：

```text
User Browser
     ↓
Preview Gateway / Reverse Proxy
     ↓
ECS
     ↓
Workspace Web Port
```

Daytona 使用专门 Proxy：

```text
{port}-{sandboxId}.{proxy-domain}
```

Google Cloud Workstations 同样使用 Gateway 把域名流量路由到具体 Workstation。

因此：

> Agent Tool 数据面与 Website Preview 数据面必须分离。

Preview 具体方案下一份文档再定。

---

# 29. WorkspaceProvider 抽象进一步确定

稳定接口不应该叫：

```text
Docker API
```

而应该是：

```text
WorkspaceProvider
```

建议：

```text
create()
start()
stop()
destroy()
getInfo()

readFile()
writeFile()
listFiles()
searchFiles()
applyPatch()

exec()
startProcess()
getProcess()
getLogs()
killProcess()

gitStatus()
gitDiff()
gitCommit()
```

---

# 30. Provider Capability

不要假定未来所有 Provider 支持完全相同能力。

定义：

```text
WorkspaceCapabilities
```

例如：

```json
{
  "fs.read": true,
  "fs.write": true,
  "fs.search": true,

  "process.exec": true,
  "process.background": true,

  "pty": false,

  "git": true,

  "lifecycle.pause": false,
  "snapshot": false,

  "preview": true
}
```

为什么必须这样设计？

因为目前阿里云 ACS Agent Sandbox 的 E2B 兼容接口已经支持：

```text
Sandbox.create
Sandbox.connect
Sandbox.kill / pause
commands.run
files.read
files.write
run_code
```

但当前并不是所有 E2B 能力都完整兼容，例如官方兼容矩阵中：

```text
upload_url / download_url
logs / metrics / network
volumes
```

仍存在未支持项。

因此不能让 Website Agent Core 依赖某个具体 Sandbox 产品的高级功能。

---

# 31. DockerWorkspaceProvider

第一版：

```text
WorkspaceProvider
        ↓
DockerWorkspaceProvider
        ↓
Workspace Gateway
        ↓
ECS Runner
        ↓
Workspace Daemon
```

---

# 32. AgentSandboxWorkspaceProvider

未来：

```text
WorkspaceProvider
        ↓
AgentSandboxWorkspaceProvider
        ↓
E2B-Compatible API
        ↓
ACS Agent Sandbox
```

映射：

```text
readFile
→ Sandbox.files.read

writeFile
→ Sandbox.files.write

exec
→ Sandbox.commands.run

start / connect
→ Sandbox lifecycle API
```

而：

```text
snapshot
pty
logs
```

根据 Provider Capability 决定是否可用。

---

# 33. 为什么这样以后迁移成本低

Agent 永远调用：

```text
workspace.readFile()
workspace.exec()
```

第一版：

```text
→ Gateway
→ Runner
→ Daemon
```

未来：

```text
→ ACS Agent Sandbox SDK
```

Website Agent Core 不需要知道底层发生变化。

---

# 34. Workspace Image / Template

AWS CodeCatalyst、Microsoft Dev Box、Daytona、E2B 都证明一个重要模式：

> Runtime 应该通过预构建 Image / Template 快速创建，而不是每次从零安装环境。

因此第一版维护：

```text
website-workspace-pboot:v1
```

里面预装：

```text
PHP
Git
SQLite
PbootCMS Base
Workspace Daemon
ripgrep
必要系统工具
```

以后：

```text
website-workspace-pboot:v2
website-workspace-wordpress:v1
```

这与未来 Agent Sandbox 的 Template / Snapshot 机制也可以自然对应。

---

# 35. Workspace Activity

参考 Codespaces、AWS CodeCatalyst、Agent Sandbox：

后续 Workspace 应拥有：

```text
lastActivityAt
```

Activity 包括：

```text
Tool Call
Terminal
Preview Activity
Agent Run
```

未来用于：

```text
Auto Stop
Auto Pause
Auto Hibernate
```

第一版 ECS + Docker 可以暂时只：

```text
RUNNING / STOPPED
```

但字段必须预留。

---

# 36. 一次 Read File 的完整调用链

用户：

> 看一下首页 Hero 是怎么实现的。

Agent 产生：

```text
read_file
```

调用：

```text
Agent
 ↓
WorkspaceService.readFile()
 ↓
Gateway Auth
 ↓
Permission Check
 ↓
Audit PENDING
 ↓
Resolve workspaceId
 ↓
Resolve runnerId
 ↓
Send WSS request
 ↓
Runner
 ↓
Resolve Container
 ↓
Call Workspace Daemon
 ↓
/v1/fs/read
 ↓
Read File
 ↓
Runner
 ↓
Gateway
 ↓
Audit SUCCESS
 ↓
Agent
```

---

# 37. 一次修改文件的调用链

```text
Agent read
 ↓
得到 sha256=A
 ↓
Agent 生成 Patch
 ↓
fs.applyPatch(expectedSha=A)
 ↓
Daemon 检查版本
```

如果文件没变：

```text
Apply
```

如果已经变化：

```text
409 FILE_CHANGED
```

Agent 重新：

```text
read
→ understand
→ patch
```

这为未来 Human + Agent 并发修改提前解决基础冲突问题。

---

# 38. 一次 Shell 调用链

用户：

> 检查 PHP 有没有语法问题。

Agent：

```text
process.exec(
  "php -l ..."
)
```

链路：

```text
Gateway
 ↓
Runner
 ↓
Daemon
 ↓
workspace user
 ↓
child process
```

Daemon：

```text
capture stdout
capture stderr
enforce timeout
enforce output limit
wait exit
```

最后返回：

```text
exitCode
stdout
stderr
duration
```

---

# 39. 长任务调用链

例如：

```text
composer install
```

Agent：

```text
process.start
```

返回：

```text
processId
```

然后：

```text
process.logs(processId, cursor)
```

持续观察。

如果异常：

```text
process.kill
```

不能让 Agent 用：

```bash
command > /tmp/log 2>&1 &
```

自行模拟进程管理。

---

# 40. 故障场景

必须提前考虑：

---

## Gateway 重启

Agent Run 状态在 DB。

Runner 自动重连。

连接恢复后：

```text
Runner Register
Heartbeat
Workspace Reconcile
```

---

## Runner 重启

Docker Container 仍可能存在。

Runner 启动后扫描：

```text
Docker labels
```

恢复：

```text
workspaceId → containerId
```

并上报 Gateway。

---

## Container Crash

Runner 检测：

```text
Container exited
```

更新 Workspace：

```text
ERROR
```

可以尝试重启。

---

## Daemon Crash

Runner Health Check 失败。

优先：

```text
restart daemon / container
```

不能让 Gateway 继续返回假成功。

---

## WSS Disconnect

未完成 Operation：

```text
read-only
```

可以根据情况安全重试。

Mutation：

```text
UNKNOWN
```

默认不自动重试。

---

# 41. Runner Reconciliation

参考 Kubernetes / Daytona Control Plane 的思路：

不要完全依赖“发一次命令”。

Runner 周期性 reconcile：

```text
Desired State
vs
Actual State
```

例如：

```text
Workspace Desired = RUNNING
Container Actual = STOPPED
```

Runner 可以恢复。

第一版可以轻量实现：

```text
periodic reconcile
```

不用直接引入 Kubernetes。

---

# 42. 第一版不需要做的内容

明确暂缓：

```text
gRPC tunnel
DERP / Tailnet
Kubernetes
Service Mesh
Multi-region scheduling
Distributed runner queue
Complex RBAC
PTY Terminal UI
Full DB API
MCP Gateway
Snapshot
Hibernate
Multi-cloud
```

但当前接口必须允许以后增加。

---

# 43. 第一版推荐技术组合

不强绑定编程语言，但逻辑上建议：

## Control Plane

```text
Website Backend
+
Agent Loop
+
Workspace Gateway
+
PostgreSQL / MySQL
+
Redis（需要多实例或 Runner 消息路由后增加）
```

## Runner

适合：

```text
Go
```

原因：

- Docker SDK 成熟；
- 单二进制；
- 并发连接；
- 资源占用低；
- 适合 Host Agent。

如果团队更熟悉 Java，也可以先 Java 实现。

技术语言不是架构约束。

## Workspace Daemon

优先：

```text
Go
```

原因：

- 单文件部署；
- 无额外 Runtime；
- 文件/进程 API 易实现；
- Streaming / WebSocket 成熟；
- 非常适合类似 E2B envd 的场景。

---

# 44. 第一版最小 Tool Set

P0：

```text
runtime.info

fs.read
fs.write
fs.list
fs.search
fs.applyPatch
fs.mkdir
fs.remove

process.exec
process.start
process.status
process.logs
process.kill

git.status
git.diff
git.log
git.commit
git.restore
```

P1：

```text
pty.*
db.*
cms.*
snapshot.*
```

---

# 45. 关键架构决策 ADR

延续第一份文档。

## ADR-011

Agent Loop 运行在 Control Plane，不运行在 Website Workspace。

## ADR-012

LLM Provider Credential 不进入 Workspace。

## ADR-013

正式执行链路不使用 Agent SSH ECS。

## ADR-014

ECS Runner 是唯一允许管理 Docker 的业务组件。

## ADR-015

Runner 主动建立到 Workspace Gateway 的 Outbound 长连接。

## ADR-016

第一版 Runner Control Channel 使用 WSS Persistent WebSocket。

## ADR-017

每个 Workspace 运行 Workspace Daemon。

## ADR-018

文件操作优先使用结构化 Filesystem API，而不是 Shell。

## ADR-019

Shell 使用 Process API，并支持 timeout、exitCode、stdout/stderr、Streaming。

## ADR-020

Workspace Agent Shell 默认以非 root `workspace` 用户运行。

## ADR-021

不同 Workspace 必须拥有基础网络和文件隔离。

## ADR-022

Docker Socket 永远不暴露给 Workspace。

## ADR-023

Tool Call 必须具有 requestId、traceId、AgentRunId，并进入 Audit。

## ADR-024

Mutation 发生不确定状态时不自动重复执行。

## ADR-025

Preview HTTP 流量与 Agent Tool Control Channel 分离。

## ADR-026

WorkspaceProvider 使用 Capability 模型，不假设所有 Provider 功能一致。

## ADR-027

DockerWorkspaceProvider 是第一版实现。

## ADR-028

AgentSandboxWorkspaceProvider 是长期重点演进实现。

---

# 46. 与优秀项目的对应关系

| 我们 | Coder | Daytona | OpenHands | E2B |
|---|---|---|---|---|
| Website Agent | Agent Loop | Client/Agent | Agent | SDK Client |
| Workspace Gateway | Control Plane | Control Plane API | Backend | API |
| ECS Runner | Workspace Infrastructure | Sandbox Runner | Docker Runtime | Orchestrator |
| Workspace Daemon | Workspace Daemon | Sandbox Daemon | Action Executor | envd |
| Workspace | Workspace | Sandbox | Runtime Container | Sandbox |
| fs.* | Daemon HTTP API | fs | File Action | files |
| process.* | Daemon Shell | process | Bash Action | commands |
| PTY | Web terminal | pty | Terminal | pty |

这说明我们的设计不是孤立方案，而是与当前成熟 Coding Agent / Sandbox 架构基本一致。

---

# 47. 长期演进图

## V1

```text
Agent
 ↓
Gateway
 ↓ WSS
ECS Runner
 ↓
Docker
 ↓
Workspace Daemon
 ↓
PbootCMS
```

## V2

增加：

```text
Permission
Audit Center
Preview Gateway
Snapshot
DB Tool
CMS Tool
```

## V3

```text
WorkspaceProvider
     ├── DockerProvider
     └── ACSAgentSandboxProvider
```

## V4

```text
CMS Adapter
     ├── PbootCMS
     └── WordPress
```

---

# 48. 下一步技术问题

本方案确定后，下一步最合理的主题是：

> **Preview 与 Production 网络架构。**

重点需要确定：

```text
用户怎么打开 Workspace 里的网站？
```

以及：

```text
Workspace Preview
        ↓
用户确认
        ↓
Production
```

需要讨论：

- Container Web Port；
- Host Reverse Proxy；
- 动态子域名；
- HTTPS；
- Preview 鉴权；
- WebSocket；
- 多 ECS 路由；
- Preview 域名；
- Production 是否与 Workspace 分离。

这是 Remote Execution 确定后的下一层。

---

# 49. 当前最终执行链路

最终基线：

```text
User
 ↓
Website Agent
 ↓
Workspace Gateway
 ↓
Auth / Permission / Audit / Routing
 ↓
Persistent WSS
 ↓
ECS Runner
 ↓
Local Daemon Endpoint
 ↓
Workspace Daemon
 ↓
Filesystem / Process / Git
 ↓
PbootCMS Website Workspace
```

核心原则：

> **Control Plane 管智能、身份和策略；Runner 管宿主机和生命周期；Daemon 管 Workspace 内执行；Workspace 只保存真实网站和运行状态。**

这套边界在 Docker MVP 中足够简单，同时可以自然迁移到 Agent Sandbox。

---

# 50. 调研资料

## Coder

- Coder Agents Architecture  
  https://coder.com/docs/ai-coder/agents/architecture

关键参考：

- Agent Loop 在 Control Plane；
- Workspace Daemon；
- Workspace 主动连接；
- Workspace 不暴露额外入站端口；
- LLM Credential 不进入 Workspace；
- Chat State 放在 Control Plane。

---

## Daytona

- Daytona Architecture  
  https://www.daytona.io/docs/en/architecture/

- File System Operations  
  https://www.daytona.io/docs/file-system-operations/

- PTY  
  https://www.daytona.io/docs/en/pty/

关键参考：

- Interface / Control / Compute Plane；
- Sandbox Runner；
- Sandbox Daemon；
- Toolbox API；
- File / Process / Git / PTY 分离；
- 独立 Proxy 处理 Sandbox Web 流量。

---

## OpenHands

- Runtime Architecture  
  https://docs.openhands.dev/openhands/usage/architecture/runtime

关键参考：

- Docker Sandboxed Runtime；
- Backend ↔ Action Execution Server；
- REST Action / Observation；
- 执行环境和 Agent Backend 分离。

---

## E2B

- E2B SDK  
  https://github.com/e2b-dev/E2B

- E2B Infrastructure  
  https://github.com/e2b-dev/infra

- envd  
  https://github.com/e2b-dev/infra/tree/main/packages/envd

关键参考：

- `files / commands / pty / git` 能力接口；
- Sandbox 内 Daemon；
- Control Plane / Data Plane 分离；
- MicroVM / Snapshot 演进方向。

---

## Google Cloud Workstations

- Architecture  
  https://cloud.google.com/workstations/docs/architecture

关键参考：

- Controller；
- Gateway；
- Workstation；
- Persistent Disk；
- 独立流量 Gateway。

---

## AWS CodeCatalyst Dev Environments

- Dev Environments  
  https://docs.aws.amazon.com/codecatalyst/latest/userguide/devenvironment.html

关键参考：

- Runtime 与 Persistent Storage；
- Stop / Resume；
- Devfile / Environment Template。

---

## Microsoft Dev Box

- Architecture  
  https://learn.microsoft.com/en-us/azure/dev-box/concept-dev-box-architecture

关键参考：

- Dev Center；
- Project；
- Pool；
- Image；
- 自助创建开发环境。

---

## 阿里云 ACS Agent Sandbox

- Agent Sandbox  
  https://help.aliyun.com/zh/cs/user-guide/agent-sandbox/

- E2B SDK Compatibility  
  https://help.aliyun.com/en/cs/user-guide/connect-to-agent-sandbox-using-the-e2b-sdk

- Security Best Practices  
  https://help.aliyun.com/zh/cs/user-guide/acs-agent-sandbox-security-best-practices

关键参考：

- MicroVM；
- E2B Compatibility；
- files.read / files.write；
- commands.run；
- Pause / Resume；
- 多租户 Quota；
- 网络隔离；
- Metadata 防护；
- Agent Sandbox 长期 Provider 演进方向。

---

## 结论

Website Coding Agent 的 Remote Execution 不应该自创一种完全不同的架构。

当前最稳妥的实现是：

```text
Control Plane
+
Gateway
+
Host Runner
+
Workspace Daemon
+
Isolated Runtime
```

第一版使用 ECS + Docker 实现这一模型。

长期将底层 WorkspaceProvider 切换到 Agent Sandbox，而 Website Agent、权限体系、工具语义和产品交互保持稳定。
