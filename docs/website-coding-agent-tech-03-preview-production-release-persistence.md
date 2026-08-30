# CloudCrane（筑云鹤）技术架构基线 03：Preview、Production、Release 与持久化

> 文档版本：V0.1  
> 状态：已确认 / Architecture Baseline  
> 前置文档：
> - `website-coding-agent-product-definition-v0.1.md`
> - `website-coding-agent-tech-01-workspace.md`
> - `website-coding-agent-tech-02-remote-execution-gateway.md`
>
> 当前 V1：阿里云 ECS + Docker + PbootCMS + SQLite  
> 当前部署目标：优先跑通完整产品闭环，不提前实现复杂集群能力

---

# 1. 本文解决的问题

本文冻结 Website Coding Agent 在以下方面的技术方案：

- Workspace / Preview 与 Production 是否分离；
- Code 与 Content 如何同步；
- Production Runtime 如何组织；
- 发布如何实现；
- PbootCMS 哪些文件属于 Release，哪些属于 Persistent Data；
- SQLite 如何使用；
- V1 如何在单台 ECS 上落地；
- Workspace / Production 如何备份和恢复；
- Preview 域名、正式域名和 HTTPS 如何处理；
- PbootCMS 域名授权如何嵌入上线流程。

本文不讨论 Agent Loop、上下文管理、Tool Calling、浏览器规划等 AI 核心架构，这部分进入下一份 Agent Architecture 文档。

---

# 2. 核心原则

```text
开发环境可以被 Agent 自由修改
生产环境必须稳定

代码可以从开发环境发布到生产
生产内容数据不能被开发数据库覆盖

生产数据库是唯一内容真源
开发数据库只是 Preview 副本
```

最终概念：

```text
一个 Website
    │
    ├── Coding Workspace
    │
    └── Production Runtime
```

---

# 3. Workspace 与 Production 分离

正式采用：

```text
Coding Workspace
    ↓
Agent Coding
    ↓
Preview
    ↓
Publish
    ↓
Production Runtime
```

不采用 `Workspace = Production`。

Workspace 允许 Agent 处于开发中间状态，也允许 Stop、Restart、Rebuild；Production 必须长期稳定运行。因此二者逻辑上永久分离。

---

# 4. 两个 Runtime，但只有一个内容数据真源

```text
                    Website

        ┌──────────────┴──────────────┐
        ↓                             ↓

Coding Workspace               Production Runtime

Dev Code                       Release Code
Preview DB                     Production DB ★
Preview Uploads                Production Uploads ★
```

Production DB / Uploads 是唯一权威数据源；Workspace 中的数据只是可重新生成的测试副本。

---

# 5. Code Up，Content Down

正式采用：

```text
Code:
Workspace → Production

Content:
Production → Workspace
```

对应两个操作：

## Publish

```text
Workspace → Production
```

主要同步：PHP、Template、CSS、JS、程序文件和明确声明的 Migration。

## Refresh

```text
Production → Workspace
```

主要同步：Database Snapshot、Uploads 和必要 Site State。

不做两个数据库之间的实时双向同步。

---

# 6. 内容修改与代码修改分流

## Content Change

例如发布文章、新增产品、修改电话、更新 Banner 内容。

长期走：

```text
User
↓
Agent
↓
CMS Capability
↓
Production
```

可以立即上线。

## Code Change

例如修改首页 Hero、调整手机导航、修改产品列表布局、修复 PHP Bug。

走：

```text
Workspace
↓
Preview
↓
Browser Verify
↓
Publish
↓
Production
```

---

# 7. 第一次上线

第一次 Publish 时允许完整初始化：

```text
Workspace

Code
Database
Uploads
Initial Config

    ↓

Production
```

第一次上线以后，默认禁止 Workspace 整库覆盖 Production。

---

# 8. 数据库结构修改

数据库结构修改统一作为 Migration：

```text
Workspace Migration Test
↓
Production DB Backup
↓
Run Migration
↓
Verify
↓
Publish Release
```

不能通过复制 Workspace DB 实现 Schema Change。

---

# 9. Production 发布模型

正式不采用 `git pull` 或 `rsync` 原地覆盖作为生产发布机制。

采用：

> Immutable Release Artifact + Atomic Switch

```text
/site/

├── releases/
│   ├── r_101/
│   ├── r_102/
│   └── r_103/
│
├── current -> releases/r_103
│
└── shared/
```

发布：

```text
Workspace
↓
Generate Release
↓
Upload OSS
↓
Production Download
↓
Extract releases/r_104
↓
Preflight
↓
current -> r_104
↓
Health Check
```

Release 本身不可变。

---

# 10. Release 回滚

```text
current -> r_104
```

发现故障：

```text
current -> r_103
```

即可快速回退代码。

---

# 11. Release Artifact Store

V1 使用阿里云 OSS：

```text
releases/
  website-123/
    r_101.tar.zst
    r_102.tar.zst
    r_103.tar.zst
```

未来 Workspace ECS 与 Production ECS 可以完全分离。

---

# 12. PbootCMS Release Manifest

PbootCMS 不按一级目录粗暴区分，而是定义四类：

```text
VERSIONED
PERSISTENT
ENVIRONMENT
RUNTIME
```

## VERSIONED

典型：

```text
apps/
core/
template/
rewrite/
index.php
admin.php
api.php
static/images/
static/backup/sql/
robots.txt
```

`template/` 必须属于 Release，因为这是 Agent 最主要的开发对象之一。

## PERSISTENT

典型：

```text
data/pbootcms.db
static/upload/
```

Production 是唯一真源。

## ENVIRONMENT

例如：

```text
config/database.php
```

Workspace 与 Production 分别维护。

## Site Config

`config/config.php` V1 默认视为 Site Config。第一次上线初始化；以后需要修改时作为明确 Config Change 发布。

## RUNTIME

例如：

```text
runtime/
```

不进入 Release。至少保证发布 Release 不主动清除 Production Session。

## Production Generated State

根目录由后台生成的动态 TXT，例如 IndexNow Key，不进入 Release 清理范围。

---

# 13. Manifest 属于 CMS Adapter

不要在 Agent Core 写死 PbootCMS 路径。

由 CMS Adapter 提供：

```text
release-manifest.yaml
```

概念：

```yaml
versioned:
  - apps/**
  - core/**
  - template/**
  - rewrite/**
  - static/images/**
  - static/backup/sql/**
  - index.php
  - admin.php
  - api.php
  - robots.txt

persistent:
  - data/**
  - static/upload/**

environment:
  - config/database.php

runtime:
  - runtime/**
```

未来 WordPress 使用自己的 Manifest。

---

# 14. Production Runtime 隔离

逻辑上：

> 一个正式网站 = 一个独立 Production Container。

多个网站可以共享同一台 ECS，但不共享 PHP Runtime。

V1 一个站点 Container 内可以同时运行：

```text
Nginx
PHP-FPM
PbootCMS
```

第一版不为了形式上的“一进程一容器”额外拆分。

---

# 15. SQLite

PbootCMS V1 正式采用 SQLite。

当前产品主要是企业官网、产品展示、文章和后台管理，写并发极低，因此无需为了未来假想负载提前引入 MySQL。

边界：

```text
Single Production Runtime + Low Write Concurrency
→ SQLite

Multi Replica / High Write / Complex Business
→ MySQL / RDS
```

Workspace 需要生产数据时，通过一致性 Backup 得到 Preview DB，不直接共享 Production DB。

---

# 16. V1 物理部署

V1 当前优先使用一台 2C4G 阿里云 ECS，采用 All-in-One Node：

```text
Alibaba ECS 2C4G

├── Website Platform
│   ├── Backend
│   ├── Agent
│   ├── Workspace Gateway
│   └── Scheduler Placeholder
│
├── Runner
│
├── Workspace Containers
│
├── Production Containers
│
└── Persistent Storage
```

逻辑上仍然保留 Control Plane / Workspace / Production 分层，但物理上不要求第一版使用三台服务器。

现有 4C8G ECS 暂时不是架构前提；以后需要时再拆。

---

# 17. V1 不实现复杂 Scheduler

第一版不实现：

```text
BinPack
Spread
Auto Scaling
Node Drain
ACK / Kubernetes
Multi-region
```

但模型继续预留：

```text
runnerId
provider
nodeRole
```

未来扩容无需推翻架构。

---

# 18. Persistent Storage

V1 核心状态路径：

```text
/site-data/{websiteId}/
```

例如：

```text
/site-data/website-123/

├── workspace/
│
└── production/
    ├── releases/
    ├── current
    └── shared/
        ├── data/
        ├── upload/
        ├── config/
        └── runtime/
```

Container 可重建，`/site-data` 才是核心状态。

---

# 19. 备份采用三层模型

正式采用：

```text
Git / Release
+
OSS Website Backup
+
ECS Snapshot
```

## Git

负责 Workspace Code History、Agent Edit History 和快速文件恢复。

## Release

负责 Production Code Rollback。

## SQLite Backup

不要直接复制运行中的数据库文件。使用 SQLite Online Backup / `.backup` 生成一致性副本，再压缩上传 OSS。

触发：

```text
每天一次
+
危险操作前
```

危险操作包括 Migration、批量删除、CMS Upgrade、大规模 Agent Content Operation。

## Upload Backup

`static/upload/` 本地为主数据，定期增量同步 OSS。

## Workspace Backup

Workspace 主保护是 Git，另外定时备份 `target/`、`references/`、`.git/` 和 Workspace Metadata 到 OSS。

## OSS Versioning

建议开启 Versioning，并使用 Lifecycle 控制历史版本保留时间。

## ECS Snapshot

每天自动快照，作为整机灾备层。

---

# 20. 恢复层级

```text
Agent 改坏代码
→ Git

新 Release 有问题
→ Release Rollback

Agent 改坏 DB
→ SQLite Backup

误删 Upload
→ OSS Versioning

整站数据损坏
→ OSS Website Backup

ECS / 云盘事故
→ ECS Snapshot / OSS Rebuild
```

未来产品可以增加 Website Snapshot，记录 Code Commit、Release、DB Backup、Upload Manifest 和 Config Version。

---

# 21. Preview 域名

Preview 使用平台自己已经备案的域名：

```text
*.preview.platform-domain.com
```

统一泛解析到平台公网入口。

每个 Website 拥有稳定 Preview Domain：

```text
site-abc.preview.platform-domain.com
```

Preview 默认 Private，并设置 noindex / nofollow。

---

# 22. Preview SSL

统一使用一张：

```text
*.preview.platform-domain.com
```

Wildcard SSL 覆盖所有 Preview Website。

---

# 23. 正式域名 V1

第一版不提供：

```text
域名销售
ICP备案代理
备案材料处理
```

用户自己负责：

```text
购买域名
ICP备案
阿里云接入备案
```

平台只要求用户提供已经可以解析到阿里云中国内地服务器的可用域名。

---

# 24. 正式域名绑定

例如用户域名：

```text
example.com
```

平台提供稳定 EIP：

```text
47.xx.xx.xx
```

引导：

```text
A → 47.xx.xx.xx
```

平台轮询 DNS，当解析结果等于 Platform EIP 时，V1 即视为 Domain Verification 成功。

第一版不额外增加 TXT Verification。

---

# 25. EIP 与公网入口

公网入口优先使用稳定 EIP。

未来 2C4G 更换为其他 ECS 时，可以重新绑定 EIP，用户 DNS 不需要修改。

V1 Gateway 推荐 Caddy，统一处理：

```text
80
443
Host Routing
Automatic HTTPS
```

Container 端口不直接公网暴露。

---

# 26. 公网安全边界

公网只开放：

```text
80
443
```

不公开：

```text
Docker API
Runner
Workspace Daemon
Production Container Internal Port
MySQL
Redis
```

SSH 仅限内部管理来源。

访问裸 EIP 或未知 Host 时必须 Reject / 404，不能默认进入任意用户网站。

未来规模增长后再增加 CDN / ESA / WAF，当前架构无需修改。

---

# 27. PbootCMS 授权

Preview 使用稳定 Preview Domain，按照 PbootCMS 官方授权机制获取授权码。

Production 正式域名同样使用官方授权机制。

V1 可以允许：

```text
用户人工获取授权码
↓
粘贴到平台
↓
平台写入对应 Runtime
```

商业化前必须联系 PbootCMS 官方讨论平台 / SaaS / OEM / 批量域名授权方案，不绕过官方授权机制。

---

# 28. V1 完整生命周期

```text
Create Website
↓
Create Workspace
↓
Preview Domain
↓
Pboot Preview Authorization
↓
Agent Coding
↓
Browser Preview
↓
First Publish
↓
Create Production Runtime
↓
User Provides Ready Domain
↓
A Record → Platform EIP
↓
DNS Verify
↓
Pboot Production Authorization
↓
Caddy HTTPS
↓
Production Active
```

后续：

```text
Code:
Workspace → Preview → Publish

Content:
Agent / CMS Admin → Production

Test Data:
Production → Refresh → Workspace
```

---

# 29. V1 明确不做

```text
Kubernetes / ACK
Automatic Multi-node Scheduling
Auto Scaling
Production Multi Replica
RDS MySQL
Blue / Green Deployment
CDN / WAF
Domain Registrar
ICP Filing Service
Complex Domain Ownership Verification
Real-time Dev/Prod DB Sync
```

---

# 30. Architecture Decisions

- ADR-029：Website 逻辑上拥有 Workspace 与 Production 两个独立 Runtime。
- ADR-030：Production DB 是唯一 Content Source of Truth。
- ADR-031：Code Up，Content Down。
- ADR-032：Content Operation 可以直接修改 Production，不强制走 Code Publish。
- ADR-033：First Publish 可以初始化 Code + DB + Uploads；之后禁止 Workspace 整库覆盖 Production。
- ADR-034：数据库结构修改通过 Migration。
- ADR-035：Production Code 使用 Immutable Release Artifact。
- ADR-036：Production 发布使用 `releases/current/shared` + Atomic Switch。
- ADR-037：Release Artifact 存储于 OSS。
- ADR-038：PbootCMS 使用 Release Manifest 区分 Versioned / Persistent / Environment / Runtime。
- ADR-039：一个 Website 对应一个 Production Container。
- ADR-040：V1 Production Container 可同时运行 Nginx + PHP-FPM。
- ADR-041：PbootCMS V1 默认 SQLite。
- ADR-042：V1 使用单台 2C4G ECS 完成闭环。
- ADR-043：逻辑架构保留多 Runner / 多 Node 扩展点，但 MVP 不实现复杂 Scheduler。
- ADR-044：Persistent Data 保存在宿主机 `/site-data/{websiteId}`。
- ADR-045：Backup 采用 Git / Release + OSS Backup + ECS Snapshot 三层模型。
- ADR-046：SQLite Backup 使用一致性 Backup，而不是直接复制运行中的 DB。
- ADR-047：Preview 使用平台备案域名的 Wildcard 子域名。
- ADR-048：V1 用户自行负责域名购买、ICP备案和阿里云接入。
- ADR-049：正式域名通过 A Record 指向平台 EIP。
- ADR-050：V1 使用 Caddy 作为公网 Gateway，并使用 Automatic HTTPS。
- ADR-051：公网仅开放 80/443，内部 Runtime / Runner / Daemon 不直接暴露。
- ADR-052：PbootCMS 域名授权严格遵循官方机制，商业化前解决平台授权问题。

---

# 31. 当前最终架构

```text
                         Internet
                            │
                          EIP
                            │
                     Caddy Gateway
                            │
            ┌───────────────┴───────────────┐
            │                               │

         Preview                        Production
            │                               │
     Workspace Container             Production Container
            │                               │
       Agent Coding                    Release Code
       Preview DB                     Production DB ★
       Preview Upload                 Production Upload ★

            ↑                               │
            └──── Refresh Content ──────────┘

            │
            └──── Publish Code ─────────────→
```

其中 Production DB / Upload 是唯一真实内容源。

---

# 32. 下一步

下一份技术架构文档进入：

> **Website Agent Architecture**

需要继续调研和确定：

```text
Agent Session
Agent Loop
Context Builder
System Prompt
Tool Calling
Task State
Browser Observe
Browser Verify
Replan
Failure Recovery
Git Commit
Conversation Persistence
Long-term Workspace Context
Multi-Agent Boundary
```

下一阶段开始进入整个产品真正的 AI 核心。
