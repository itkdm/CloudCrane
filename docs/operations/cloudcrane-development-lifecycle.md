# CloudCrane 工程生命周期与当前实现

> 当前状态核对：2026-10-04。本文是日常工程流程与当前实现状态的入口；详细架构决策见 Tech-01 至 Tech-07，服务器操作见对应运维手册。服务器与 GitHub Actions 状态会变化，操作前仍应按实时环境复核。

## 文档和状态的事实来源

- 根目录 `AGENTS.md`：协作规则、边界和验收要求。
- 本文：代码修改、提交、CI/CD 流程，以及当前主要 vertical slice 的实现/验证摘要。
- [Production 部署手册](cloudcrane-production-deploy.md)：平台部署、主机隔离和运维命令。
- [Preview 运维手册](cloudcrane-operations-preview.md)：Preview DNS、TLS 和入口配置。
- [Tech-03](../architecture/website-coding-agent-tech-03-preview-production-release-persistence.md)：Production、Release、内容数据方向和 CMS 能力的架构与实现状态。
- 产品提案、早期架构章节和带日期的验收记录是设计背景或历史证据；不能覆盖本文中的较新状态。

CloudCrane 平台自身的 Production 部署，与用户将某个 Website 发布到 Production，是两条不同的流程。

## 当前代码能力概览

| 能力 | 当前状态摘要 |
| --- | --- |
| Workspace / Agent / Preview | 长期 Website Workspace、Agent 编码工具和 Preview 已实现；真实服务验收必须使用远程完整服务栈。 |
| Website Production Publish | 有 Release 构建、运行时、原子切换、健康检查、授权 API/UI 和 Nginx/Gateway 公网入口；指定测试站已完成多次发布与故障恢复场景验收。 |
| Production → Workspace Refresh | 有安全快照、备份后替换、SQLite 校验、操作恢复和幂等流程；只把 Production 内容数据回流，不覆盖 Workspace 代码。 |
| Production CMS 操作 | 已有内容/栏目读取、内容与公司信息更新、内容创建、媒体上传和受限栏目创建。CI 覆盖 PbootCMS 3.2.24/3.2.26；相应线上验收证据和边界见 Tech-03。 |
| Workspace 宿主机隔离 | Runner 容器有项目配额；Metadata host-level deny 已有容器及服务/Docker/主机重启验证。当前 Guest OS 是 KVM，云销售商/控制面未核实。 |
| 平台 CI/CD | `main` push 触发 CI；CI 成功后部署 workflow 对比上次成功部署的 SHA，只对包含运行代码/配置的变更执行平台部署。纯文档变更会跳过 SSH 部署和平台重启。 |

这些摘要描述代码和已有验收证据，不代表每次部署后的实时健康状态。各操作的精确验收范围和证据边界以对应测试/运维文档为准。

## 日常开发与提交

项目默认直接在 `main` 工作。开始前先检查工作区、分支、最近提交和 remote；需要最新基线时执行 `git fetch origin`。保留已有改动，不覆盖未知状态。一个明确功能点完成、适用检查通过且 diff 审查完成后，按 Conventional Commit 提交并推送 `main`。

平台代码通常在本机编辑并运行适用的静态/单元检查；真实服务联调和用户流程验收使用远程完整服务。不要为了完成普通功能修改而先在本地搭建 Docker、PostgreSQL 或全套服务。只有用户明确要求本地全栈时，才使用 README 中的可选流程。

提交前按改动范围运行检查。常规代码改动使用：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:migration:check
git diff --check
```

文档专属改动至少运行 `pnpm format:check` 与 `git diff --check`。Docker、PHP、远程执行、数据库或 UI 边界以 CI / 远程验收证据为准；本机未运行或 skipped 的项目不能标成通过。

## Build 配置经验

Next.js `pnpm build` 在配置收集阶段会导入认证和数据库模块，因此**即使构建不会访问数据库，也要求** `DATABASE_URL` 和至少 32 字符的 `BETTER_AUTH_SECRET`。本地缺少它们时出现 `DATABASE_URL is required` 属于配置初始化失败，不表示已经访问数据库或数据库连接失败。

只检查本机构建时，可对当前 PowerShell 进程临时设置非生产占位配置；数据库 URL 指向未监听的回环端口：

```powershell
$env:DATABASE_URL = 'postgresql://cloudcrane:cloudcrane@127.0.0.1:65432/cloudcrane'
$env:BETTER_AUTH_SECRET = 'ci-only-secret-with-at-least-32-characters'
$env:MODEL_CREDENTIAL_ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000'
$env:WEB_ORIGIN = 'http://localhost:3000'
pnpm build
Remove-Item Env:DATABASE_URL, Env:BETTER_AUTH_SECRET, Env:MODEL_CREDENTIAL_ENCRYPTION_KEY, Env:WEB_ORIGIN
```

这些值只供构建配置初始化，不能用于启动服务、跑迁移或判断 Website 列表/线上数据库状态。需要真实 PostgreSQL 的构建与集成检查由隔离的 GitHub CI 服务完成；不要把生产 Secret 复制到本机。

## CI 与平台 CD

`.github/workflows/ci.yml` 对 `main` push 和 Pull Request 运行格式、lint、类型、单测、构建、数据库迁移检查，以及 Docker/Pboot/远程执行集成任务。

`.github/workflows/deploy-production.yml` 由成功的 `main` push CI 触发，只部署该次 CI 验证的 SHA。部署 workflow 会将目标 SHA 与最近一次成功部署比较：变更仅涉及 `docs/**`、README/AGENTS/CHANGELOG/CONTRIBUTING 文档时，CI 仍运行，但 SSH 部署和服务栈重启会跳过；包含应用、部署脚本或配置的变更才执行部署及公网健康检查。不要与自动部署并发进行人工发布。

每次交付应按该提交的 GitHub Actions 运行记录确认 CI 与 Deploy 最终状态；提交成功或健康接口可用不能替代完整的用户流程验收。

## 远程服务与用户流程验收

默认开发联调通过 SSH 隧道访问远程完整服务栈 `http://localhost:3000`；线上公开入口是 `https://app.itkdm.com`。`localhost:3001` 仅用于用户明确要求的“本机 Web + 远程后端”备用流程。不要用未加载远程配置的本机 Web 或本地空数据库判断远程数据和服务状态。

Workbench、Chat、Preview、Refresh、Workspace 生命周期及 Agent 用户流程优先通过 DEVTOOLS MCP 验收，并检查 UI 截图、Network、Console 和刷新后的状态。按项目约定，DEVTOOLS 不可用时可以用内置浏览器核验可见 UI 和截图，但报告需注明缺少 Network/Console 证据；不能把浏览器可见性验证说成全部 E2E 通过。登录使用 [E2E 测试账号说明](../testing/cloudcrane-e2e-test-account.md)，凭据只从本机忽略文件读取，不写入仓库或聊天。

Preview 与 Production 使用不同的站点域名：`{previewSlug}.preview.itkdm.com` 与 `{productionSlug}.site.itkdm.com`。生产入口由 Nginx 终止 TLS，再分别反代平台服务和 Preview/Production Gateway。当前主机服务商未核实，不要把架构设计中的“阿里云 ECS”写成当前生产环境事实。

## 当前线上验收证据索引

- Website Production 的 Release 发布、发布中刷新/响应丢失恢复、正式页面访问和内容数据保持：见 [Tech-03 实现状态](../architecture/website-coding-agent-tech-03-preview-production-release-persistence.md)与下方专用 CMS 验收记录。
- CMS 更新后的 Pboot 页面缓存失效：已在专用授权测试站预热页面、修改内容、通过公网确认新值，再恢复原值；Docker CI 同时覆盖缓存清理错误路径和持久目录保留。
- CMS 内容创建：测试站新建草稿后通过 `cms_get_content` 读回核对字段；Create 响应丢失后的持久幂等恢复由 Docker 集成覆盖。
- CMS 图片附件上传：用户消息中的 JPEG 经 Agent 上传到 Production，并在公网确认图片可渲染；Agent Run 终态与图片副作用的关系在验收记录中有区分，截图可见但没有 DEVTOOLS Network 面板证据。
- CMS 栏目创建：测试站在已启用列表栏目下新建默认隐藏的子栏目，并通过栏目读取工具复核；功能不开放单页、模型或任意 Pboot 字段。
- Workspace 配额与 Metadata 隔离：主机/真实容器核验及服务、Docker、整机重启记录见[生产部署手册](cloudcrane-production-deploy.md)。

所有这些是已完成的功能和特定环境验收证据，不意味着每种浏览器、CMS 模板或生产故障场景都已覆盖。不要把历史失败记录或本机可视化截图复制为当前验证结果。
