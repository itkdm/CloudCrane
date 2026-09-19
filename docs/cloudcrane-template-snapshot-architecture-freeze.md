# CloudCrane Template Snapshot Architecture Freeze

状态：Architecture Freeze（V1）
适用版本：CloudCrane Template Snapshot V1
冻结日期：2026-09-19

## 1. 目标模型

CloudCrane 的 Website 不是一个可被 Template ZIP 整体替换的目录，而是：

```text
Website = CloudCrane Managed Pboot Core + Versioned Site State
```

Template 的语义固定为：

```text
Template = Versioned Site State Snapshot
```

Template 不携带旧的 PbootCMS Core，不覆盖入口文件、授权逻辑或 CloudCrane 运行时。

## 2. 职责和数据边界

| 分类 | 内容 | Snapshot 行为 |
| --- | --- | --- |
| `MANAGED_CORE` | `index.php`、`admin.php`、`api.php`、`apps/`、`core/`、`rewrite/`、`config/database.php`、CloudCrane 初始化文件 | 不打包；由当前 Managed Base 提供 |
| `SITE_STATE` | `template/`、`skin/`、`m/`、`static/` 中的站点资源、根目录站点资源、自定义站点目录、站点业务 SQLite 数据 | 保留原值，发布和恢复时确定性处理 |
| `EPHEMERAL_RUNTIME` | `runtime/`、`session/`、日志、缓存、临时升级文件、`.cloudcrane/references/`、Git 元数据 | 丢弃，不进入 Artifact |
| `CORE_DRIFT` | 相对该 Website Managed Base 的 Core 文件修改或新增 | 阻止自动发布，输出可审计的 drift 列表 |

`config/config.php` 和 `config/route.php` 属于 Site Config/站点自定义配置；`config/database.php`
属于运行时环境配置，由当前 Managed Base 提供，不随 Snapshot 复制。配置边界不再按整个
`config/` 目录一刀切。

`data/pbootcms.db` 虽然属于 `SITE_STATE`，但仍是 Website 运行时数据库，受 `data/*.db` 的 Git
忽略规则保护。发布和恢复必须执行 SQLite `PRAGMA integrity_check`；恢复时数据库要完成
Managed State Rebind，但不得因为数据库被 Git 忽略而阻断文件状态提交。

内容（公司信息、电话、邮箱、文章、产品、图片、栏目、SEO、模型、扩展字段、轮播和友情链接）不自动脱敏、不自动删除。实例绑定信息、授权、管理员登录态和 CloudCrane 内部状态不随 Snapshot 复制。Pboot `ay_site.acode` 是业务关联键，属于站点业务状态；V1 只重绑定 `domain`，不单独改写 `acode`。

状态策略：

| 状态 | 决策 |
| --- | --- |
| Pboot 业务内容和站点配置 | `preserve` |
| 域名、Pboot 授权、实例 ID、CloudCrane Website/Workspace 绑定 | `rebind` |
| Session、cache、runtime、日志、Git、Reference、内部 Token | `drop` |
| Core Drift、未知 Snapshot schema、源 DB 高于目标版本、缺失迁移链、损坏 DB | `block` |

## 3. Source of Truth

| 对象 | Source of Truth |
| --- | --- |
| Template 元数据 | PostgreSQL `template` |
| Snapshot 内容 | `TEMPLATE_ARTIFACT_ROOT` 中的 immutable Artifact |
| Snapshot 身份 | Artifact SHA-256、大小和 Manifest |
| Website 选定 Artifact | PostgreSQL `website_template_attachment` |
| Managed Core | Pinned CloudCrane Pboot Base Manifest / 镜像 |
| Website 业务内容 | Website Workspace 的 `data/pbootcms.db` |
| Reference | Agent Service 生成的只读派生投影，不是 Website 真源 |

既有 Artifact hash、staging isolation、路径/符号链接检查、孤儿清理、Attachment CAS、stale reclaim、`attemptCount` fencing、Attachment 与 Website 原子提交、Internal API 边界和 Reference 只读挂载必须保留。

## 4. Snapshot Artifact

Artifact 使用 ZIP 容器，顶层固定为：

```text
manifest.json
payload/
```

Manifest 最少包含：

```json
{
  "artifactType": "cloudcrane-pboot-site-snapshot",
  "snapshotSchemaVersion": 1,
  "cms": "pbootcms",
  "sourceWebsiteId": "...",
  "sourcePbootVersion": "3.2.26",
  "sourceCoreCommit": "...",
  "dbEngine": "sqlite",
  "dbSchemaVersion": "3.2.26",
  "createdAt": "..."
}
```

Manifest 不包含密码、Cookie、Token、授权码或其他 Secret。Artifact 继续使用当前 ZIP 大小、展开大小、文件数、单文件大小、路径穿越、重复文件、符号链接和 SHA-256 限制。

## 5. 发布链路

```text
Website Workspace
  → Runner / Workspace Gateway 受控 Snapshot Builder
  → Core Drift 检查
  → SQLite integrity_check
  → Manifest + payload staging
  → Artifact hash/size/security validation
  → 原子写入 TEMPLATE_ARTIFACT_ROOT
  → PostgreSQL template record
```

Web 不直接读取宿主机 Workspace，Agent Service 不获取 Docker 权限。运营者 CLI 可以发起任务，但文件读取和打包必须经 Workspace Gateway → Runner → Workspace Daemon 边界。

## 6. 恢复链路

```text
创建 Website
  → 当前 Managed Core bootstrap
  → immutable Snapshot Reference materialize
  → Manifest preflight
  → staging 文件和 staging DB
  → source version 检查
  → 官方 Pboot migration chain
  → integrity/schema/启动校验
  → 原子 promote
  → Website/Attachment 状态原子提交
```

Snapshot Restore 不由 LLM 手工执行；Agent 只负责 Core Drift 或复杂二开兼容工作。恢复必须幂等、可重试，并在迁移、文件 promote 或验证失败时保留旧 Workspace 可用。

## 7. PbootCMS 版本策略

CloudCrane Managed Base 以经过验证的 upstream commit 锁定。本轮将基线升级到官方稳定的 PbootCMS `3.2.26`，commit `8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea`；此前镜像基线为 `3.2.24`，commit `29ff72ee5afc9c6553b949f04d3fc99443879f40`。

升级必须同时更新 Base、启动 marker、README、官方迁移脚本和集成测试，不能只修改版本字符串。迁移编排只使用官方 SQL 或从官方历史 commit 固定提取的 SQL；未知版本、降级和缺失迁移链必须 fail closed。

## 8. 与 External Reference 的区分

用户上传的外部整站是 `external/untrusted`：只读分析、normalizer、Agent 重建，不允许整体覆盖 Core 或 DB。CloudCrane 自己生成、带签名/哈希和版本 Manifest 的 Snapshot 是 `internal/versioned`：可以进入确定性 Restore Engine，但仍不得覆盖 Managed Core 和实例绑定状态。

现有 `cloudcrane-normalize-k714` 保留为 K714 专用 external import 能力；它的 staging、数据库快照、rollback 和 failure injection 机制可提炼复用，但不把固定版本、主题和表白名单提升为通用 Snapshot 规则。

## 9. 交付顺序

先实现无破坏的 Manifest、Core release metadata、分类器和 Snapshot Builder 单元/集成测试；再实现官方迁移链和 Snapshot Apply Engine；最后接入 Website 创建、运营者发布入口、Docker integration 和生产 DEVTOOLS E2E。每一阶段保留既有 Template Attachment 行为并通过回归测试。
