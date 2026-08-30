# CloudCrane（筑云鹤）技术架构基线 01：Website Workspace

> 文档版本：V0.1  
> 状态：已确认 / Architecture Baseline  
> 当前阶段：MVP  
> 首选云厂商：阿里云  
> 当前 Workspace 实现：ECS + Docker  
> 后续重点演进方向：Agent Sandbox

---

## 1. 本文目的

本文确定 Website Coding Agent 的第一项核心技术决策：

> **Website Workspace 在第一阶段采用“阿里云 ECS + Docker”实现。**

同时明确 Workspace 的边界、基本组成、Agent 与 Workspace 的关系，以及后续向 Agent Sandbox 演进时需要提前保留的架构抽象。

本文暂不详细确定：

- ECS 具体规格；
- 一台 ECS 放多少 Workspace；
- Agent 远程通信协议；
- Preview URL 方案；
- Production 部署方式；
- 域名、DNS、SSL；
- ICP 备案；
- 计费模型；
- Workspace 调度算法。

以上内容后续单独设计。

---

# 2. Website Workspace 定义

Website Workspace 是一个网站长期存在的独立开发与维护空间。

它不是一次性的代码执行 Sandbox，也不是单纯的网站服务器。

一个 Workspace 至少拥有：

```text
Website Workspace

├── Website Source Code
├── CMS Runtime
├── PHP Runtime
├── Database
├── Static Assets
├── Git Repository
├── Shell Environment
├── Agent Tools
├── Runtime Logs
├── Preview Capability
└── Persistent Storage
```

用户第一次创建网站以后，Workspace 会长期保留。

后续用户再次修改网站时，Agent 直接进入原 Workspace 继续工作。

---

# 3. 第一阶段基础设施方案

第一阶段使用：

```text
阿里云 ECS
    ↓
Docker
    ↓
Website Workspace Container
```

整体模型：

```text
                     Website Platform
                            │
                    Workspace Gateway
                            │
                ┌───────────┴───────────┐
                │                       │
            Aliyun ECS              Aliyun ECS
                │                       │
        ┌───────┼───────┐       ┌───────┼───────┐
        ↓       ↓       ↓       ↓       ↓       ↓
      WS-A    WS-B    WS-C    WS-D    WS-E    WS-F
     Docker  Docker  Docker  Docker  Docker  Docker
        │       │       │       │       │       │
      Volume  Volume  Volume  Volume  Volume  Volume
```

第一阶段不采用：

```text
一个网站 = 一台独立 ECS
```

原因：

- 成本高；
- 启动慢；
- 管理复杂；
- 资源利用率低；
- 不适合 To C 大量 Workspace。

第一阶段采用：

> **多个 Website Workspace 共享 ECS 宿主机，但每个 Workspace 使用独立 Docker Container 和独立持久化存储。**

---

# 4. Workspace Container

每创建一个网站，平台创建一个 Workspace Container。

概念镜像：

```text
website-workspace-pboot:v1
```

镜像基础能力包含：

```text
Linux
PHP
Nginx / Web Runtime
Git
SQLite
必要 PHP Extensions
PbootCMS Base
Workspace Tools
Agent Runtime Dependencies
```

具体是否让每个 Container 内运行独立 Nginx，还是宿主机统一反向代理到 Container，后续单独设计。

---

# 5. Workspace 文件结构

建议统一 Workspace 内部目录协议：

```text
/workspace

├── target/
│   ├── apps/
│   ├── core/
│   ├── config/
│   ├── data/
│   ├── static/
│   ├── template/
│   └── ...
│
├── references/
│   └── reference-001/
│
├── tools/
│
├── knowledge/
│
├── logs/
│
├── snapshots/
│
└── workspace.yaml
```

## target/

真正的网站项目。

第一版为 PbootCMS。

## references/

用户选择或导入的参考模板、参考项目。

原则上默认只读。

Agent 根据参考项目修改 `target/`。

## tools/

Workspace 内提供给 Agent 的辅助命令和工具。

未来可能包含：

```text
cms
site
preview
validate
backup
deploy
```

## knowledge/

提供给 Agent 的站点知识和开发规范，例如：

```text
PBOOT.md
WORKSPACE.md
SITE.md
```

## logs/

运行日志、Agent 操作日志等。

## snapshots/

后续用于数据库、文件或 Workspace 快照。

第一版可以暂时不完整实现。

---

# 6. 持久化设计原则

Container 可以销毁和重建。

网站数据不能因此丢失。

因此：

> **Container 是计算环境，Volume 才是 Workspace 的持久状态。**

至少以下内容必须持久化：

```text
target/
references/
knowledge/
logs/
workspace.yaml
必要数据库数据
Git Repository
```

概念上：

```text
Container
   │
   └── mount
          ↓
/srv/workspaces/{workspaceId}
```

即使：

```text
Container Crash
Container Upgrade
Container Recreate
```

Workspace 仍然可以恢复。

---

# 7. Workspace 与 Agent 的关系

Agent 不应该直接持有阿里云 ECS 的 Root SSH 权限。

正确模型：

```text
User
  ↓
Website Agent
  ↓
Workspace Gateway
  ↓
Workspace Tools
  ↓
Docker Container
```

Workspace Gateway 负责统一承接：

```text
File Read
File Write
File Search
Shell Execute
Git
Database
Process
Preview
Logs
```

第一版可以内部通过：

```text
docker exec
docker cp / mounted volume
process execution
```

实现。

但是 Agent 上层不能绑定 Docker 命令。

---

# 8. 必须提前抽象 WorkspaceProvider

从第一版开始定义统一的：

```text
WorkspaceProvider
```

例如：

```text
createWorkspace()
startWorkspace()
stopWorkspace()
destroyWorkspace()

execCommand()
readFile()
writeFile()
listFiles()

getStatus()
getRuntimeInfo()

createSnapshot()
restoreSnapshot()

getPreviewEndpoint()
```

第一版实现：

```text
DockerWorkspaceProvider
```

底层：

```text
Aliyun ECS
+
Docker
```

未来实现：

```text
AgentSandboxWorkspaceProvider
```

底层可能使用：

```text
ACS Agent Sandbox
E2B-compatible Sandbox
其他 MicroVM Sandbox
```

上层 Website Agent 不应该因为底层 Workspace Provider 变化而重写。

---

# 9. 第一版 Agent 权限

MVP 阶段：

```text
一个 Workspace
=
一个 Owner
```

Owner 可以让 Agent：

- 读取 Workspace 文件；
- 修改 Workspace 文件；
- 搜索文件；
- 执行 Shell；
- 操作 Git；
- 操作数据库；
- 修改 PHP；
- 修改 HTML/CSS/JS；
- 启动网站；
- 查看日志；
- 运行验证；
- 执行部署相关操作。

当前阶段优先验证完整 Agent Coding Loop，不做复杂 RBAC。

但必须保证：

> **Workspace A 绝不能访问 Workspace B。**

即使 MVP，也必须保证不同用户 Workspace 之间的基础隔离。

---

# 10. Agent Coding Loop

Website Workspace 必须支持完整 Coding Agent 工作模式：

```text
Understand
   ↓
Search
   ↓
Read
   ↓
Edit
   ↓
Run
   ↓
Observe
   ↓
Fix
   ↓
Verify
   ↓
Commit
```

因此 Workspace 不能只是文件存储。

必须是真实可运行环境。

---

# 11. Git

每个 Workspace 默认初始化独立 Git Repository。

建议：

```text
/workspace/target/.git
```

Agent 每次较完整的修改后形成 Commit。

至少支持：

```text
git status
git diff
git log
git commit
git restore
```

Git 用于：

- 查看 Agent 修改；
- 回滚代码；
- 保留历史；
- 辅助审计；
- 后续多人协作。

数据库版本与文件快照后续单独设计。

---

# 12. PbootCMS 在 Workspace 中的位置

PbootCMS 是第一版 CMS Runtime，不是 Workspace 本身。

关系：

```text
Website Workspace
      │
      ├── Runtime
      ├── Agent
      ├── Tools
      └── CMS
            ↓
         PbootCMS
```

未来可以替换为：

```text
WordPress
Halo
Drupal
其他 CMS
```

因此禁止将：

```text
Workspace Core
```

设计成：

```text
PbootCMS Core
```

---

# 13. PbootCMS Base

平台维护自己的：

```text
PbootCMS Base Image / Base Package
```

基于官方稳定版本制作。

原则：

- 不让每个 Workspace 创建时直接拉官方 master；
- 使用固定版本 / Commit；
- 平台验证后再升级；
- CMS 升级与网站模板数据分离；
- 保留官方授权机制；
- 禁止修改或绕过授权。

后续可以定义：

```text
pboot-base-v1
pboot-base-v2
```

用于 Workspace 创建与升级。

---

# 14. Workspace 生命周期

第一阶段预计至少存在：

```text
CREATING
RUNNING
STOPPED
ERROR
DELETING
```

后续 Agent Sandbox 可以增加：

```text
HIBERNATED
RESUMING
SNAPSHOTTING
RESTORING
```

第一版 Docker Workspace：

```text
Create
 ↓
Running
 ↓
Stop
 ↓
Start
 ↓
Destroy
```

持久数据独立保存。

---

# 15. Workspace 与 Production

当前阶段只确认：

> Workspace 是开发与维护环境。

最终 Production 是否：

### 方案 A

直接使用 Workspace Container 提供线上网站；

还是：

### 方案 B

Workspace 只负责开发，确认后发布到独立 Production Runtime；

暂时不在本文确定。

长期更推荐逻辑上区分：

```text
Workspace
   ↓
Build / Validate
   ↓
Deploy
   ↓
Production
```

这样有利于：

- 安全；
- 回滚；
- 多人协作；
- Agent 实验；
- 环境隔离。

但 MVP 可根据实现成本简化。

---

# 16. Preview

Workspace 必须最终具备：

```text
Preview Endpoint
```

Agent 和用户都可以访问修改后的站点。

后续需要设计：

- Container Port；
- Reverse Proxy；
- Workspace Subdomain；
- 临时 Preview URL；
- HTTPS；
- Access Token；
- Preview 生命周期。

具体方案放到后续技术文档。

---

# 17. 为什么第一阶段选择 ECS + Docker

## 优点

### 1. 技术成熟

Docker、Linux、ECS 均为成熟基础设施。

### 2. Debug 简单

开发阶段可以直接：

```text
docker ps
docker logs
docker exec
```

排查问题。

### 3. 自由度高

可以完整控制：

- PHP；
- Nginx；
- SQLite / MySQL；
- Git；
- Browser 工具；
- Agent 工具。

### 4. 成本可控

一台 ECS 可以承载多个低负载企业官网 Workspace。

### 5. 适合 MVP

不会把大量时间消耗在复杂云原生基础设施上。

---

# 18. ECS + Docker 的长期问题

该方案不是最终形态。

主要问题：

### 1. Shared Kernel

Docker Container 共享宿主机 Kernel。

面对不可信 Agent Code 时，隔离强度有限。

### 2. 多租户安全复杂

后续需要处理：

- Container Escape；
- CPU / RAM；
- Fork Bomb；
- 网络攻击；
- 磁盘耗尽；
- Secret 泄露。

### 3. Workspace 调度

规模上升后需要自行实现：

- ECS 调度；
- Container Placement；
- Autoscaling；
- Resource Quota；
- Failure Recovery。

### 4. 休眠成本

停止 Container 可以释放部分运行压力，但宿主 ECS 本身持续计费。

因此：

> ECS + Docker 是 MVP 最优解，但不一定是长期最优解。

---

# 19. 后续重点：Agent Sandbox

后续优先评估阿里云：

> ACS Agent Sandbox

或同类型 Agent Sandbox 基础设施。

长期理想模型：

```text
Website Workspace
=
Agent Sandbox
```

需要重点验证：

- MicroVM 隔离；
- Filesystem；
- Shell；
- Persistent State；
- Pause / Resume；
- Checkpoint；
- Custom Image；
- Network Policy；
- Resource Quota；
- Preview Port；
- SDK；
- E2B Compatibility；
- 成本；
- SLA；
- 国内地域支持。

当 Agent Sandbox 成熟后，可以实现：

```text
DockerWorkspaceProvider
        ↓
AgentSandboxWorkspaceProvider
```

而不改变 Website Agent 上层逻辑。

---

# 20. 为什么 Agent Sandbox 是长期重点

Website Coding Agent 的 Workspace 本质是：

```text
长期状态
+
不可信代码执行
+
Shell
+
文件系统
+
网络
+
Agent
+
动态生命周期
```

这与 Agent Sandbox 的产品方向高度一致。

Agent Sandbox 天然更适合：

- To C 多租户；
- 不可信 Agent Code；
- Workspace 隔离；
- 按使用计费；
- 休眠；
- 快照；
- 动态创建；
- 大规模调度。

因此长期基础设施不建议完全自研 Sandbox。

---

# 21. 当前架构决策

当前正式确认：

## ADR-001

**Website Workspace 第一阶段采用阿里云 ECS + Docker。**

## ADR-002

**一个 Website Workspace 对应一个独立 Docker Container + 独立持久化数据目录。**

## ADR-003

**多个 Workspace 可以共享同一 ECS。**

## ADR-004

**Agent 不直接 SSH ECS，通过 Workspace Gateway / Workspace Provider 操作 Workspace。**

## ADR-005

**从第一版开始抽象 WorkspaceProvider。**

## ADR-006

**第一版实现 DockerWorkspaceProvider。**

## ADR-007

**PbootCMS 是第一版 CMS Runtime，但不是 Workspace Core。**

## ADR-008

**未来优先增加 AgentSandboxWorkspaceProvider，重点关注阿里云 ACS Agent Sandbox。**

## ADR-009

**MVP 可以放宽单 Workspace 内 Agent 权限，但不同 Workspace 必须隔离。**

## ADR-010

**Workspace 必须支持 Persistent Storage、Git 和真实 Runtime，不能设计成一次性代码 Sandbox。**

---

# 22. 下一份技术文档

下一步优先讨论：

> **Agent 如何远程操作 Website Workspace？**

需要确定：

```text
Website Agent
      ↓
Workspace Gateway
      ↓
???
      ↓
Docker Workspace
```

具体讨论：

- Agent 服务运行在哪里；
- Gateway 运行在哪里；
- File Tool 如何实现；
- Search Tool 如何实现；
- Edit Tool 如何实现；
- Shell 如何实现；
- Shell 是否使用 docker exec；
- DB Tool 如何实现；
- Git Tool 如何实现；
- 日志如何流式返回；
- Command Timeout；
- Process Management；
- Workspace Session；
- 网络安全；
- 权限拦截；
- Tool API；
- 是否兼容 E2B 风格接口。

这是服务器方案确定后的下一项关键技术决策。

---

# 23. 后续待讨论技术文档

建议后续按以下顺序继续：

1. **Workspace Remote Execution / Workspace Gateway**
2. **Preview 网络与访问方案**
3. **Workspace 生命周期与资源调度**
4. **Persistence / Volume / Backup / Snapshot**
5. **Production Deployment**
6. **域名 / DNS / SSL**
7. **权限、审计与安全模型**
8. **Agent Sandbox Migration**
9. **CMS Adapter**
10. **成本与计费模型**

---

## 最终基线

第一阶段的 Website Workspace 可以概括为：

```text
阿里云 ECS
    ↓
Docker Host
    ↓
独立 Website Workspace Container
    ↓
Persistent Volume
    ↓
PbootCMS + PHP + Git + DB + Tools
    ↑
Workspace Gateway
    ↑
Website Coding Agent
```

第一版目标：

> **先用最成熟、可控、容易 Debug 的 ECS + Docker，把 Website Coding Agent 的完整开发闭环跑通。**

长期目标：

> **当 Agent Sandbox 产品成熟后，将 Workspace Provider 演进到 MicroVM / Agent Sandbox，实现更强的 To C 多租户隔离、弹性和休眠能力。**
