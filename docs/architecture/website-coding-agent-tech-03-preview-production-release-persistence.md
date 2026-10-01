# CloudCrane（筑云鹤）技术架构基线 03：Preview、Production、Release 与持久化

> 文档版本：V0.1  
> 状态：已确认 / Architecture Baseline  
> 前置文档：
> - `../product/website-coding-agent-product-definition-v0.1.md`
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
    r_101.zip
    r_102.zip
    r_103.zip
```

未来 Workspace ECS 与 Production ECS 可以完全分离。

---

# 12. PbootCMS Release Manifest

PbootCMS 不按一级目录粗暴区分，而是定义四类：

```text
VERSIONED
PERSISTENT_INITIAL
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
`data/**` 和 `static/upload/**` 只在首次 Publish 初始化；后续 Release 不携带这些路径，避免用 Workspace 状态覆盖 Production。

## ENVIRONMENT

例如：

```text
config/database.php
```

Workspace 与 Production 分别维护。

## Site Config

`config/config.php` V1 视为 Site Config。首次 Publish 初始化；后续普通 Release 不携带该文件。以后需要修改时走明确的 Config Change 操作。

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

V1 实现使用 `manifest.json`，每个条目记录相对路径、字节数、SHA-256 和文件分类。Release ZIP 以流式方式生成，避免将整个站点文件同时载入内存。Artifact 最大 500 MiB，展开总量最大 1 GiB，单文件最大 100 MiB，最多 20,000 个文件。生产端必须验证 manifest、路径、文件数/大小和哈希后再解压。

Release ZIP 与 Template Snapshot 是不同的制品：Template Snapshot 用于网站状态迁移；Production Release 是不可变代码版本，首次发布时才包含要初始化的 Persistent 数据。

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

本节的 Gateway 指用户 Website Production Runtime 的入口，不是 CloudCrane 平台自身的 `app.itkdm.com` / Preview 公网入口。当前 CloudCrane 平台入口已选择 Nginx。

Website Production Runtime 尚未实现。V1 选择 Nginx 作为生产入口，Gateway 需处理：

```text
80
443
Host Routing
HTTPS / 证书状态
```

Container 端口不直接公网暴露。Nginx 只转发到受管 Production Container 的 loopback 绑定端口；未知 Host 必须拒绝。证书签发/续期及动态 Host 配置还需在 Gateway 实现阶段完成端到端验证。

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
Nginx HTTPS
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
- ADR-050：Website Production Runtime V1 使用 Nginx 作为公网入口；Container 不直接公网暴露。动态 Host 路由、证书签发/续期、安全配置生成须由 Production Gateway 统一管理。
- ADR-051：公网仅开放 80/443，内部 Runtime / Runner / Daemon 不直接暴露。
- ADR-052：PbootCMS 域名授权严格遵循官方机制，商业化前解决平台授权问题。
- ADR-053：CloudCrane 平台当前公网 Ingress 使用 Nginx；与 ADR-050 的 Website Production Runtime Gateway 属于不同部署角色。
- ADR-054：Production Release V1 使用流式 ZIP 与 `manifest.json`；选择依据是仓库已依赖的 `fflate` 支持流式 ZIP，且可在不新增外部压缩运行时的情况下实现 SHA-256 和路径校验。制品格式与 Template Snapshot 相互独立。
- ADR-055：首次 Publish 可初始化 `data/**`、`static/upload/**` 和 `config/config.php`；后续普通 Release 永不覆盖这三类 Production 状态。

## Implementation Status (2026-10-01)

- 已部署 Production runtime/release schema，已实现流式 Release ZIP builder、SHA-256/manifest 校验及受限 ZIP 解压器。
- Runner 已增加独立 `DockerProductionProvider` 和 PHP 8.4 + Nginx production image。Provider 为每个 Website 创建独立网络/容器，runtime 代码只读、rootfs 只读、无额外 Linux capability，随机 HTTP 端口仅绑定 `127.0.0.1`；`current` 通过同目录临时 symlink + rename 原子切换。First publish 初始化共享数据，后续 Release 不从 Artifact 解出持久路径。
- Production 镜像同时安装 `SQLite3` 与 `pdo_sqlite`：锁定的 PbootCMS 3.2.26 原生 SQLite 驱动使用 `SQLite3`。Workspace 的源数据库仍叫 `data/pbootcms.db`；Production 首发复制为每站独立的 `shared/data/cloudcrane.db`，受管 `config/database.php` 保持 `/data/cloudcrane.db` 站点相对路径，由 `current/data` symlink 连接共享数据。Production 授权 helper 从受管数据库配置解析文件位置。
- Production Nginx 基于锁定 PbootCMS 版本的 `rewrite/nginx.txt` 路由规则：不存在的路径改写为 `index.php?p=...`；`/apps/admin/view/` 仅允许所需静态资源扩展名，`/core/code.php` 为唯一放行的 Core HTTP 入口。`/data`、`/config`、`/runtime`、其他 `/core`、其他 `/apps` 与 `/static/backup` 仍被拒绝。
- Release manifest/ZIP builder、安全解压、独立 `DockerProductionProvider`、Production operation executor 和 Workspace Gateway dispatch 已实现。Release 使用独立 Production runtime，持久化数据与代码分离；切换失败会恢复旧 Release。ECS Runner 需要本机存在 `PRODUCTION_IMAGE` 指定的 Production image；CD 在配置正式域名后应构建该 image，再启动 Production Gateway。
- Web Publish API 已接入账户 entitlement/quota、同源和网站访问授权、幂等 operation、审计、运行中 AgentRun 拒绝、Workspace 停止时按需启动、Release 制作/部署及未知结果查询。Website Settings 已有发布、状态、正式 URL 和 PbootCMS Production 授权界面。发布和授权目前仍需在实际域名/DNS/TLS 和 CI 集成验证完成后才可作为对外可用功能。
- `apps/production-gateway` 只监听 `127.0.0.1:4104`，按随机 128-bit slug + 配置后缀从数据库查 Production Runtime，仅代理 `authorization_required` / `active` 状态，未知 Host 返回 404，数据库/上游错误返回 503/502。请求/响应按流转发并移除 hop-by-hop headers。Nginx 站点模板提供 wildcard Host、TLS、80→443 和 loopback proxy 配置；用受限变量列表运行 `envsubst`，避免改写 Nginx 自身变量。
- Website 删除现在先销毁 Production Container、Network、持久化目录和其 Release Artifact，再删除 Workspace 与网站记录；Runner 启动时会为 Production Container 补齐 `unless-stopped` 策略并恢复有当前 Release 的停止容器。首发持久化初始化可按 release 所有权标记安全回滚和重试，stage/deploy 能从已有制品或当前健康 Release 恢复；跨 Runner 错误码保留明确的 Production 错误语义。Production 查询从宿主机授权标记读取状态，不依赖对停止容器执行 Docker exec。
- 发布的 `current` symlink 只表示候选代码。Runner 在通过健康检查后原子写入 `shared/.verified-release`；启动恢复和 Production 状态查询会验证未提交的 `current`，健康则提交，失败则恢复上一个已验证版本。Web 在切换期间将 Production 状态置为 `activating`，Production Gateway 对该状态返回可重试的 503，防止将未验证版本公开服务。页面把发布 Idempotency-Key 保存在网站级 localStorage，刷新后可用同一 Key 恢复；运行中的请求定期更新时间戳，崩溃后由已有持久 operation/release 状态支持重试。
- Production 容器的本机健康检查必须携带该站点的规范 Production Host、`X-Forwarded-Host` 和 `X-Forwarded-Proto=https`。PbootCMS 会按访问域名校验站点；用 `127.0.0.1` 作为 Host 可能返回 404，即使正式域名入口和站点文件正常。Production Runtime 通过镜像内固定的 `/_cloudcrane/health` PHP 探针验证 PHP-FPM、当前 Release 入口、共享目录和 SQLite；该探针不依赖 Pboot 首页授权状态。公网授权验证仍须按真实 HTTPS Host 执行。
- First publish 回滚还会清空 `shared/runtime`，仅对仍持有首发初始化 marker 且尚无已验证 Release 的操作生效；普通 Release 失败不会清理 Production runtime/session。
- 成功发布后默认保留当前 Release、上一 Release 和最近 5 个 Release；旧 Release 目录及已登记 Artifact 可回收，未完成制品有 7 天保护期。`PRODUCTION_KEEP_RELEASES` 可设为 2 至 100。
- Production 正式域名使用 `<productionSlug>.site.itkdm.com`。2026-10-01 已核实并配置 wildcard DNS、TLS 和生产 Nginx → Production Gateway 入口；Gateway 健康检查和未知 slug 的拒绝行为已在线验证。指定测试站 `CloudCrane Production E2E`（Website `0d173aae-2ae4-422d-87de-930d63d3c775`）已使用与 Workspace 相同的受管 PbootCMS 3.2.24 基线成功创建 Production Runtime 并激活 Release #7（`b8973262-fafe-4167-aaf6-f914b334d3ab`）；镜像内 `/_cloudcrane/health` 返回 204，数据库状态为 `authorization_required`。公网域名已通过 Nginx/Gateway 路由到该 Release；Pboot 首页仍因缺少该 Production 域名的官方授权码返回 404，不能据此宣称正式网站可访问。Production 容器重启后仍运行且镜像健康探针返回 204；本轮为重建停止的测试容器分配了新 loopback 端口，随后核对并修正了该测试站 `production_runtime.production_port`，修复前公网 502、修复后 Gateway 将未授权 Pboot 的 404 正常返回。此次暴露出运行容器端口变化后必须同步控制面记录；真实的授权后页面、第二次发布、数据保留、Release 切换和 Runner 重启恢复仍待线上 E2E 验收。CD 构建新 Production 镜像不会自动替换已存在的 Website 容器：测试时发现旧容器仍引用旧镜像 ID，虽然请求镜像 tag 相同；本轮仅重建了这个已停止且无网络端点的测试容器，保留其共享数据。现有运行容器镜像漂移的安全升级/回滚策略尚未实现，应在验证滚动替换前作为已知运维缺口。TLS 自动续期仍缺 Cloudflare DNS Edit 凭据和自动 hook。Artifact 使用 ECS 本地存储，没有 OSS。
- GitHub-hosted Docker integration 覆盖 Production image 构建、锁定的真实 PbootCMS 3.2.26 Workspace 初始化、Production 首发、后台资源/验证码、数据库路径、敏感路径阻断、伪静态入口和第二次 Release 的 Production DB 保留；另有纯 PHP fixture 检查 Runner 的容器边界与失败恢复。CI 的 Docker integration 是该链路的真实容器验收；本机 Docker 不是开发依赖。

---

# 31. 当前最终架构

```text
                         Internet
                            │
                          EIP
                            │
             Nginx Website Production Gateway (not enabled)
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
