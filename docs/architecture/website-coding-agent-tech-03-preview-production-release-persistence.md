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
- Web Publish API 已接入账户 entitlement/quota、同源和网站访问授权、幂等 operation、审计、运行中 AgentRun 拒绝、Workspace 停止时按需启动、Release 制作/部署及未知结果查询。Website Settings 已有发布、状态、正式 URL 和 PbootCMS Production 授权界面。目标 E2E 站已完成授权、Release #12 与公网访问验证；自动端口恢复/Runner 故障注入仍未完成，见下方 2026-10-02 更新。
- `apps/production-gateway` 只监听 `127.0.0.1:4104`，按随机 128-bit slug + 配置后缀从数据库查 Production Runtime，仅代理 `authorization_required` / `active` 状态，未知 Host 返回 404，数据库/上游错误返回 503/502。请求/响应按流转发并移除 hop-by-hop headers。Nginx 站点模板提供 wildcard Host、TLS、80→443 和 loopback proxy 配置；用受限变量列表运行 `envsubst`，避免改写 Nginx 自身变量。
- Website 删除现在先销毁 Production Container、Network、持久化目录和其 Release Artifact，再删除 Workspace 与网站记录；Runner 启动时会为 Production Container 补齐 `unless-stopped` 策略并恢复有当前 Release 的停止容器。首发持久化初始化可按 release 所有权标记安全回滚和重试，stage/deploy 能从已有制品或当前健康 Release 恢复；跨 Runner 错误码保留明确的 Production 错误语义。Production 查询从宿主机授权标记读取状态，不依赖对停止容器执行 Docker exec。
- 发布的 `current` symlink 只表示候选代码。Runner 在通过健康检查后原子写入 `shared/.verified-release`；启动恢复和 Production 状态查询会验证未提交的 `current`，健康则提交，失败则恢复上一个已验证版本。Web 在切换期间将 Production 状态置为 `activating`，Production Gateway 对该状态返回可重试的 503，防止将未验证版本公开服务。页面把发布 Idempotency-Key 保存在网站级 localStorage，刷新后可用同一 Key 恢复；运行中的请求定期更新时间戳，崩溃后由已有持久 operation/release 状态支持重试。
- Production 容器的本机健康检查必须携带该站点的规范 Production Host、`X-Forwarded-Host` 和 `X-Forwarded-Proto=https`。PbootCMS 会按访问域名校验站点；用 `127.0.0.1` 作为 Host 可能返回 404，即使正式域名入口和站点文件正常。Production Runtime 通过镜像内固定的 `/_cloudcrane/health` PHP 探针验证 PHP-FPM、当前 Release 入口、共享目录和 SQLite；该探针不依赖 Pboot 首页授权状态。公网授权验证仍须按真实 HTTPS Host 执行。
- First publish 回滚还会清空 `shared/runtime`，仅对仍持有首发初始化 marker 且尚无已验证 Release 的操作生效；普通 Release 失败不会清理 Production runtime/session。
- 成功发布后默认保留当前 Release、上一 Release 和最近 5 个 Release；旧 Release 目录及已登记 Artifact 可回收，未完成制品有 7 天保护期。`PRODUCTION_KEEP_RELEASES` 可设为 2 至 100。
- Production 正式域名使用 `<productionSlug>.site.itkdm.com`。2026-10-01 已核实并配置 wildcard DNS、TLS 和生产 Nginx → Production Gateway 入口；Gateway 健康检查和未知 slug 的拒绝行为已在线验证。指定测试站 `CloudCrane Production E2E`（Website `0d173aae-2ae4-422d-87de-930d63d3c775`）以与 Workspace 相同的受管 PbootCMS 3.2.24 基线创建 Runtime 并激活 Release #7；随后完成正式授权并发布至 Release #12。2026-10-02 的端口恢复和 Production E2E 见下方历史记录。CD 更新 Production image tag 不会自动重启每个网站；`de9511d` 增加了只在单站显式 `production.ensure` 时比较 immutable image ID 并安全替换旧容器的路径，同时支持替换中断后的恢复，不会在平台部署或 Runner 启动时批量升级站点。该路径已于 2026-10-04 用目标测试站验证。TLS 自动续期仍缺 Cloudflare DNS Edit 凭据和自动 hook。Artifact 使用 ECS 本地存储，没有 OSS。

> 更新（2026-10-02）：后续 E2E 已完成正式域名授权；发布中刷新与丢失 Web 响应两种场景均恢复到正确 Release，Production SQLite 与上传文件数量保持不变。端口元数据复用和状态 API 端口同步提交 `399d8764` 已通过 CI #466、Deploy #65。部署后容器映射从 `32799` 变为 `32800`，控制库仍记旧端口导致公网暂时 502；只同步该 E2E Runtime 的端口后公网恢复 200、探针 204。干净内置浏览器标签中的目标 Settings 正常；此前长驻标签显示旧测试站 Settings，是旧页面状态，不能据此判断站点 ID 映射有缺陷。正常 Republish 激活 Release #13（`c3907824-fca3-4aa6-81ed-32571e7fa54e`），Runner 在 Production root 写入 `.production-port=32800`；公网首页仍显示 `Release 2 验收`，SQLite 哈希与上传数未变。随后将 E2E Runtime 数据库端口短暂设回 `32799` 并再次通过干净 UI Republish；界面回到 `Website is live`，公网首页 200、探针 204。Gateway 每次请求均重新查询数据库，目标容器只监听 `32800`，故公网恢复说明自动流程已把流量重新指向正确端口；SSH 连续超时使数据库行与最终 Release ID 未能独立读取。容器重建复用元数据、独立 Runner 重启故障注入仍未完成。容器镜像滚动升级/回滚和 TLS 自动续期仍未实现。

## Implementation Status (2026-10-03): Production → Workspace Refresh

- Website Settings 增加手动刷新入口和覆盖确认。该操作只回流 `Production SQLite + uploads`，不回流 Release 代码、授权或 Runtime 私有状态。
- Web API 使用 website lifecycle advisory lock、持久化 operation、幂等键与审计；在刷新期间拒绝新的 Agent run 和 Publish，并拒绝已有 Agent run、发布或 Release 切换。
- Runner 使用 Production 容器中的 PHP `SQLite3::backup()` 创建一致数据库副本。Production 持续服务；上传目录用复制前后及副本的哈希清单校验，检查到复制期间变化时安全失败。
- Workspace 替换前比较 Production 快照和当前 Workspace SQLite schema 指纹；结构不一致会在替换前拒绝刷新，不自动迁移数据库或代码。
- Workspace 替换前保留 DB、SQLite sidecar 和 uploads 备份；Preview 停止后替换内容、验证 SQLite，再启动 Preview。未完成操作通过 Workspace 持久恢复标记回滚。
- Docker 集成测试覆盖成功刷新、内容方向、代码保留、生产快照保留和无效数据库拒绝。GitHub CI 和正式站 Settings E2E 尚待本次实现推送后执行；通过前不能标记线上功能验收完成。
- Refresh 的完整操作步骤、覆盖范围和 schema 兼容限制见 [Production 内容刷新到 Workspace](../operations/cloudcrane-production-content-refresh.md)。
- GitHub-hosted Docker integration 覆盖 Production image 构建、锁定的真实 PbootCMS 3.2.26 Workspace 初始化、Production 首发、后台资源/验证码、数据库路径、敏感路径阻断、伪静态入口和第二次 Release 的 Production DB 保留；另有纯 PHP fixture 检查 Runner 的容器边界与失败恢复。CI 的 Docker integration 是该链路的真实容器验收；本机 Docker 不是开发依赖。

## Implementation Status (2026-10-03): Production CMS Semantic Capability V1

- Agent 新增 `cms_list_categories`、`cms_list_content`、`cms_get_content`、`cms_update_content`、`cms_get_company`、`cms_update_company`。通用协议位于 `@cloudcrane/cms-protocol`；Pboot 表名、数据库和规范化规则只存在于镜像内受信任 adapter。
- CMS 读取和写入通过 Workspace Gateway → Runner 的 allowlisted production operation。Production adapter 只启动固定 `cloudcrane-pboot-cms` 可执行文件并经 JSON stdin/stdout 交换数据；Agent 不获得 Production SQL、shell、任意文件或 Docker 能力。
- 更新要求当前 version；Production SQLite 在 `BEGIN IMMEDIATE` 内重读、比较 SHA-256 canonical version、写入 allowlisted patch 并读回。检测到目标 patch 已应用时安全 replay；否则以 `CMS_CONTENT_CHANGED` 拒绝旧版本覆盖。超时或响应不确定时返回 `UNKNOWN_RESULT`，Agent 重试同一 patch/version 可安全恢复。
- 支持代码根据锁定的 PbootCMS 3.2.26 源码 `8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea` 编写，并复用 Production 镜像中该版本的编码/规范化函数。CMS 更新只审计操作、记录 ID 与字段名，返回 `workspaceContentStale: true`；不会把正文同步到 Workspace，也不会改变 Release 代码。
- Refresh Issue #1 修复为持久 key 按精确 idempotency key 查询，页面恢复仅继续未完成操作；成功、失败或找不到时清理旧 key，后续新点击创建新操作。Issue #2 修复为业务刷新成功后审计收尾异常只记日志，不把已成功 operation 改写为失败。
- Unit/regression tests 已覆盖协议、工具、版本冲突/安全重试路径、审计脱敏和 Refresh key 恢复。真实 PbootCMS Docker integration 已扩展到读写、扩展字段、外部修改冲突、Refresh 单向同步、代码/Production DB 保留；本机没有 Docker/PHP，容器用例以 GitHub CI 结果为准。指定线上站的 Workspace 是 PbootCMS 3.2.24；后续 CI 已把 3.2.24 纳入完整 Production CMS/Refresh 集成，当前兼容结论与线上 E2E 阻塞见本文 2026-10-04 更新。
- CMS semantic hardening follow-up：CMS 写事务提交后，Runner 复用发布切换的缓存清理与 PHP-FPM graceful reload；失效失败返回 `UNKNOWN_RESULT`，相同 version/patch 重试走 adapter replay 并再次清缓存。Protocol 区分 numeric content row ID 与 1–20 位 Pboot logical code（字母、数字、`_`、`-`）；Pboot filename 更新同时拒绝与其他内容 ID 冲突。Docker integration 的 Pboot 3.2.24/3.2.26 用例已由 CI 在 `9117c351` 通过。
- ECS Workspace host boundary follow-up：Runner 通过 ext4 project quota 为每个持久 Workspace 设置 1 GiB 默认硬块限制和 inode 限制；ECS Docker bridge 对 `100.100.100.200/32` 安装 host-level deny，保留普通 HTTPS egress。生产 ECS 已迁移到 30 GiB ext4 quota filesystem；两档独立 project quota 写入、真实 Workspace 容器的 Metadata GET/Token PUT 拒绝与公网 HTTPS 连通性验收已通过，Runner 和两个 Gateway 健康检查通过。部署 SHA 为 `9117c351`。systemd Docker drop-in 已安装且规则存在，但本轮未主动重启 Docker/主机做故障注入；ECS 控制面的 Metadata token-required 模式状态也未核实。完整验收记录和脚本见 `docs/operations/cloudcrane-production-deploy.md`。

---

## Implementation Status (2026-10-04): CMS Content Create V2

- Production CMS 新增内容只允许选择已存在且启用的列表模型栏目；单页模型、栏目创建和媒体上传不在此能力范围内。默认 `status=0`（未发布），只有用户明确要求立即发布时才允许 `status=1`。
- Create 的请求幂等键必填，并与规范化业务请求哈希绑定。Runner 内存缓存拒绝同 key 不同请求；受信 Pboot adapter 在同一个 SQLite `BEGIN IMMEDIATE` 事务里提交内容行、扩展字段和幂等结果指针，因此 Runner/容器重启或响应丢失后仍能安全重试。
- SQLite 只保存幂等 key 的 SHA-256、请求哈希、创建出的内容 ID 和时间，不保存原 key 或文章正文。相同 key/相同请求返回既有内容；相同 key/不同请求返回 `IDEMPOTENCY_KEY_REUSED`；内容后来被删除时返回 `CMS_CREATE_RESULT_UNAVAILABLE`，避免误建第二条。
- `cloudcrane_cms_content_create_ops` 是 Production 专用操作账本，不属于 PbootCMS 内容 Schema。Refresh 只在待导入的快照副本中删除该表，再执行 Schema 比对；Production 原库不变，幂等记录也不会进入 Workspace。
- PbootCMS 3.2.24 与 3.2.26 均由 GitHub Docker integration 覆盖；CI #504 验证了 3.2.24 的 Publish、CMS 读写、Refresh 和第二次 Publish。Production 容器镜像更新由单站 `production.ensure` 显式触发：比较 immutable image ID，健康检查通过前保留旧容器，复用 loopback port 与持久挂载，并检查 CMS helper；Runner 启动时只恢复中断的替换，不批量升级网站。该路径于 CI #515 / Deploy #114 后在指定线上测试站成功执行；详细证据见下方线上 E2E 记录。

## Implementation Status (2026-10-04): CMS Content Create 与线上 E2E

- 当前基线 `de9511d` 的 CI #515 quality、Docker integration 均通过；Deploy production #114 成功。CI 覆盖 PbootCMS 3.2.24/3.2.26 的容器集成，目标站 Publish 和 CMS Create 也完成线上 E2E。
- 首次 UI 尝试中，对线上 `CloudCrane Production E2E`（Website `0d173aae-2ae4-422d-87de-930d63d3c775`）发起的只读 CMS 类别/内容查询均返回 `CMS_OPERATION_FAILED`。Runner 和 Production Gateway 健康检查正常；Runner 结构化日志确认 CMS operation 失败。当时没有执行 CMS Create，也没有修改线上 CMS 内容。
- 首轮只读检查发现目标容器运行 Production 旧 image ID `f4004062…`，而 ECS 的 `cloudcrane-production-pboot:v1` 已指向 `8afbf096…`。旧容器内缺少 `cloudcrane-pboot-cms`；新镜像包含 `/usr/local/bin/cloudcrane-pboot-cms`。这解释了首轮失败，不是 PbootCMS 3.2.24 不兼容，也不需要重建 Website 或数据库。
- 收到项目负责人授权后，通过内置浏览器对目标测试站执行一次 Republish。只读 ECS 检查确认目标容器与 `cloudcrane-production-pboot:v1` 的 image ID 一致（`8afbf096…`）、容器为 running，且 `/usr/local/bin/cloudcrane-pboot-cms` 存在。Website Settings 显示 `Website is live`；Production 公网首页正常返回 PbootCMS 页面。未重建 Website、未更换授权或 Release 数据。
- 线上 CMS Create E2E 先从 Production 读取 11 个栏目，选择已启用列表栏目 `scode=3`，创建状态 `0` 草稿（内容 ID `18`，标题 `CloudCrane CMS Create E2E 0a45493`）。首次创建返回 `replayed=false`；随后通过 Production `cms_get_content` 复核了 ID、标题、正文、栏目、状态和版本一致。创建后 `workspaceContentStale=true`，符合 Production 是内容源、Workspace 需显式 Refresh 的语义。整个过程未使用 Bash 或直接 SQL，也未修改既有内容、代码、模板、授权或 Release。
- 线上这一次 Create 是首次请求成功返回，没有模拟响应丢失。Docker integration 覆盖了数据库事务提交后返回 `UNKNOWN_RESULT`、Runner 重启后用相同 key 与 payload replay、仅创建一条记录、不同请求复用 key 返回 `IDEMPOTENCY_KEY_REUSED`。CMS 更新的缓存测试验证了提交后缓存清理失败会返回 `UNKNOWN_RESULT`，相同 version/patch 重试会 replay 并再次清理缓存。该自动化现已加强为同一 Pboot 首页缓存先读到旧值、retry 后读到新值，并恢复原值的真实容器 HTTP 检查；CI #515 已通过。
- UI 在刷新页面后仍显示完成结果；内置浏览器可核实页面和 Console（本次 0 条 warning/error）。本次未使用 DEVTOOLS MCP，因此 Network 面板证据未采集。线上截图保存在本机 Codex visualizations 目录，未纳入 Git。

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

Production → Workspace Refresh 完成并通过线上 E2E 后，下一阶段按产品优先级进入 Release History / 用户主动 Rollback、Production Backup / Restore、自定义域名和支付接入。Agent 架构的原始编写顺序已被当前已落地实现取代；不再将 Tech-04 中的历史“下一步”段落视为当前排期。
