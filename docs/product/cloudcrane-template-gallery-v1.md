# CloudCrane 模板目录与快照发布（V1）

> 文档状态：实现与运维说明，最近按当前 Web/API、模板发布器和 Pboot 快照实现核对于 2026-09-27。它描述仓库中的代码路径，不代表生产环境已经部署或目录中已有可供用户选择的模板。架构约束以[模板快照架构冻结文档](../architecture/cloudcrane-template-snapshot-architecture-freeze.md)为准。

## 边界与事实来源

- `template` 表是 Catalog Metadata 的事实来源。
- `TEMPLATE_ARTIFACT_ROOT` 是私有、不可变 ZIP Artifact 的事实来源；Artifact 不通过浏览器直接访问。
- `website_template_attachment` 固定 Website 实际使用的 Artifact key、SHA-256 和 Reference 状态。
- Agent Service 拥有 Reference materialization；Runner 只按既有 Workspace Reference 机制以只读方式挂载。
- Agent Service 与 Runner 必须使用同一个显式 `WORKSPACE_REFERENCE_ROOT`；生产环境缺少该变量时两个服务都会拒绝启动，避免模板“发布成功但容器没有挂载”的静默错误。
- 模板 ZIP 的发布端和消费端共用同一组大小上限（ZIP 500 MB、展开 1 GB、单文件 100 MB）；发布成功的 Artifact 不会进入消费端无法处理的大小区间。
- Website 是 Demo 的所有者。模板广场不会创建第二套 Demo Runtime，`demoUrl` 只是已独立部署样例站的链接。

## 发布路径

当前代码包括两种受控发布入口：运营侧可用 Agent Service 的 `template:publish` 维护命令导入经审核的 ZIP；Website Agent 也有发布当前 Website 快照的受限工具。两者都生成新的不可变 Artifact 与 Catalog 记录，不提供通用用户投稿管理后台或可变更的 Artifact。发布命令示例：

```bash
pnpm template:publish --archive=/secure/approved-template.zip \
  --name=企业展示 \
  --description=适用于企业展示的网站起点 \
  --category=企业官网 \
  --demo-url=https://example.invalid
```

ZIP 导入器只允许 `template/`、`skin/`、`static/` 三类主题目录，拒绝管理员、认证、授权、Secret、运行时、缓存、日志、Git 和符号链接。导入时独立计算 SHA-256，并使用不可覆盖的随机 Artifact key。归档上限为 500 MiB、展开大小上限为 1 GiB、单文件上限为 100 MiB。快照发布入口使用 Pboot 快照清单，并按共享限制校验内容。已发布 Artifact 不允许原地更新；内容更新必须发布新的 Template。

仓库内 `templates/official-enterprise` 是用于验证发布链路的最小官方样例，不代表完整生产主题。生产发布前应使用经过产品和安全验收的真实 PbootCMS 主题 ZIP。

## 使用模板与失败恢复

```text
POST /api/websites { name, templateId }
→ 校验 published Template
→ 创建普通 Website + Workspace
→ 初始化 Managed PbootCMS Base
→ Agent Service 校验 Artifact SHA-256
→ 原子 materialize 到该 Workspace 的只读 Reference
→ authorization_required
```

Template Reference 失败不会删除已经创建的 Website/Workspace，而是保留 `template_attach_failed` 和关联失败信息。可以调用：

```text
POST /api/websites/:websiteId/template-attachment/retry
```

重试使用 attachment 中固定的 Artifact key/hash，不重新读取当前 Catalog，也不会重复创建 Website 或 Workspace。

## 并发、安全与部署约束

- Reference 解压使用按 `workspaceId`、`referenceId` 和随机 attempt 隔离的 staging 目录；最终目录仍保持稳定，重复使用同一快照保持幂等。
- Attachment 状态迁移使用前置状态条件和数据库原子自增：`pending → materializing → ready/failed`，并发重试不会覆盖已完成状态，成功或重新开始时会清理旧错误。
- `materializing` 使用 10 分钟 stale threshold；进程崩溃或写回失败后，下一次重试会通过 `status + updatedAt` 条件原子 reclaim，正常进行中的任务不会被抢占。
- Internal Template API 只允许服务间 Token；生产环境不再提供默认 Token。公网 Nginx 还必须拒绝 `/agent/v1/internal/`，Web 通过回环地址调用该接口。
- 发布失败时会删除已经写入但尚未完成数据库登记的 Artifact，避免积累孤儿 ZIP。发布器同时拒绝隐藏敏感目录、凭据文件和可执行/证书类扩展名。

生产部署配置至少需要：

```text
NODE_ENV=production
WORKSPACE_REFERENCE_ROOT=<Agent 与 Runner 共用的绝对路径>
AGENT_SERVICE_INTERNAL_TOKEN=<随机服务间 Token>
TEMPLATE_ARTIFACT_ROOT=<私有 Artifact 目录>
WORKSPACE_MANAGED_PBOOT_BASE_ROOT=<Runner 可读取的官方 Managed Pboot 基线目录>
```

部署后还需按生产变更流程执行 `nginx -t` 并 reload；公网访问 `/agent/v1/internal/` 应返回 404。以上是部署验收要求，不表示当前环境已完成部署或验证。

## 当前 Web/API 行为

- `GET /api/templates` 要求有效会话，只返回已发布目录项；可选 `category` 参数可用于服务端筛选。目录卡片由 Web 客户端按返回数据筛选分类，显示名称、描述、分类、封面和可选 Demo 链接。
- 创建 Website 时可提交 `templateId`。API 检查模板存在、已发布且 CMS 类型为 `pbootcms`，然后走普通 Website/Workspace 创建，并关联固定的 Artifact key 与 SHA-256。
- 附件状态失败时，保留 Website/Workspace 与失败状态；重试针对原附件快照，不会读取后来变更的 Catalog 项，也不会重复创建 Website/Workspace。
- 仓库中的 `templates/official-enterprise` 仅是最小样例目录说明，不是完整主题 Artifact，也不保证模板数据库内已登记对应项目。
