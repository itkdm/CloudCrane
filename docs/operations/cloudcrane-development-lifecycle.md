# CloudCrane 日常开发、CI 与发布生命周期

> 状态核对日期：2026-09-30。本文区分当前仓库已配置的流程、已确认的协作决定和仍待部署信息的事项；线上健康状态会变化，发布前仍需重新检查。

## 适用范围

本文描述 CloudCrane 平台仓库的工程生命周期。它不等于在 CloudCrane Website Workspace 中修改某个托管网站，也不表示托管网站的 Production Release 能力已经上线。

- 修改 CloudCrane 平台：改本仓库的 `apps/`、`packages/`、`docker/`、`deploy/` 或文档，按本文执行。
- 修改某个托管网站：在对应 Website Workspace 中修改并用 Preview 检查。Website Production 发布目前仍受 [Tech-03](../architecture/website-coding-agent-tech-03-preview-production-release-persistence.md) 所述路线约束；模板 Artifact 发布是另一项能力，见[模板目录与快照发布说明](../product/cloudcrane-template-gallery-v1.md)。

## 已确认的协作约定

- 日常工作直接在 `main` 上进行，不另建功能分支或要求 Pull Request。
- 一个明确功能点或约定的提交点完成，且适用的本地检查通过后，Codex 自动创建 Conventional Commit 并推送 `main`。有未完成改动、检查失败或基线/远端状态不明时，不把它包装成完成点。
- 推送会触发 GitHub Actions CI。当前 CI 检查格式、lint、类型、单测、构建、数据库迁移，并运行 Docker/远程执行集成任务。
- 生产发布采用 CI/CD：`main` 的 push CI 成功后，部署 workflow 将部署同一个已验证 commit，并检查线上健康入口。首次端到端发布已验证：CI `#404` 和 Deploy production `#1` 均成功，生产运行 SHA 为 `973d9bb4cca32b2d576fa2fc394dc403cf878c7c`。

## 运行环境边界

日常代码编辑和不依赖服务的质量检查在本机仓库完成；应用、数据库和 Workspace 的真实联调、用户流程验收默认使用线上远程服务。不要把补齐本地 Docker、PostgreSQL 或全栈服务作为常规任务的前置条件。只有用户明确要求本机全栈调试时，才执行下面的可选本地流程。

### 可选：本机全栈开发

要求 Node.js 22+、pnpm 10+ 和 Docker。根目录 README 的本机流程是：

```bash
pnpm install --frozen-lockfile
cp .env.example .env
docker compose -f docker/compose/docker-compose.yml up -d postgres
pnpm --filter @cloudcrane/db db:migrate
pnpm dev
```

Windows PowerShell 下复制配置可用：

```powershell
Copy-Item .env.example .env
```

`.env.example` 仅为本地占位配置；`.env` 被 Git 忽略，不能把生产值复制到其中或提交。当前示例默认开启邮箱验证，但没有 Resend 凭据；若本机未配置邮件服务，需在 `.env` 将 `AUTH_REQUIRE_EMAIL_VERIFICATION` 和 `NEXT_PUBLIC_AUTH_REQUIRE_EMAIL_VERIFICATION` 都设为 `false`，否则注册邮件无法投递。本地关闭验证不适用于生产。数据库迁移仅操作当前 `DATABASE_URL` 指向的数据库，运行前确认它是本地数据库。退出 `pnpm dev` 后可停止本地 PostgreSQL：

```bash
docker compose -f docker/compose/docker-compose.yml down
```

不要使用 `down -v`，否则会删除本地 PostgreSQL 数据卷。

此可选本机开发流程不满足真实 CloudCrane 用户流程验收。不要用未加载远程配置的本地 Web 检查线上 Website 列表、Agent、Workspace 或部署状态。

### 本机执行 Build 时的配置要求

Next.js 在配置收集阶段会初始化认证和数据库模块，因此 `pnpm build` 即使不启动服务，也要求 `DATABASE_URL` 和至少 32 字符的 `BETTER_AUTH_SECRET`。单纯检查构建时可使用与 CI 相同的非生产占位值；数据库 URL 指向未监听的测试端口，避免连到本机现有 PostgreSQL：

```powershell
$env:DATABASE_URL = 'postgresql://cloudcrane:cloudcrane@127.0.0.1:15432/cloudcrane'
$env:BETTER_AUTH_SECRET = 'ci-only-secret-with-at-least-32-characters'
$env:MODEL_CREDENTIAL_ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000'
$env:WEB_ORIGIN = 'http://localhost:3000'
pnpm build
Remove-Item Env:DATABASE_URL, Env:BETTER_AUTH_SECRET, Env:MODEL_CREDENTIAL_ENCRYPTION_KEY, Env:WEB_ORIGIN
```

这些值只用于本机 Build 配置检查，不能拿来启动服务、迁移数据库或访问线上数据。如果 Build 开始时需要真实数据库连接，应让 GitHub CI 使用其 PostgreSQL 服务完成构建；不要改用本机 5432 上来源未知的数据库，也不要复制生产 Secret 到本机环境。

## 一次平台改动的步骤

1. 开始前检查 `git status --short --branch`、当前分支、`git log`、remote 和相关文件；确认没有需要保留的用户改动。默认远端基线以当前 `main` 为准，需要跟进最新远端代码时先 fetch。
2. 按改动边界阅读根 `AGENTS.md`、相关工程 Skill 和相应架构/运维文档。冻结架构与实际代码冲突时先记录，不能静默改写基线。
3. 实现最小改动。数据库 schema 变化需新增迁移，不重写已执行迁移；Secret 不进入仓库、日志、截图或最终报告。
4. 运行适用检查：

   ```bash
   pnpm format:check
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm db:migration:check
   git diff --check
   ```

   涉及真实 PostgreSQL 的迁移/集成检查必须连接专用测试库；不能拿生产库代替。本地没有 Docker 或测试数据库时如实记录阻塞，不能标成通过。

5. 涉及 Web UI、Chat、Preview、Workspace 生命周期或 Agent 用户流程时，先按[本地远程开发恢复记录](cloudcrane-local-remote-dev-recovery.md)核实端口和 SSH 隧道，再连接真实开发服务。优先用 DEVTOOLS MCP；如果它不可用，可按根 `AGENTS.md` 的新约定用 Codex 内置浏览器完成可见 UI 验证，并说明该浏览器能核验和不能核验的证据。不能把生产首页的只读浏览说成已完成开发服务 E2E。
6. 检查 staged diff 和最终 Git 状态；明确功能点完成且本地检查通过后，自动提交并推送 `main`。报告 Base SHA、提交 SHA、改动、检查结果和阻塞项。
7. 等 GitHub Actions CI 成功。CI 失败时修复或记录失败，不把未通过状态当作可发布版本。

## 生产发布：目标和当前状态

### 目标流程

```text
功能点完成 → 本地检查 → commit/push main
            → GitHub Actions CI 全绿
            → CD 自动部署
            → 健康检查与线上浏览器验收
```

此为已确认的目标流程。上线后应通过正式入口 `https://app.itkdm.com` 验证本次变更对应的用户流程；DEVTOOLS MCP 优先，内置浏览器可作可见 UI 验收替代。涉及登录或写入数据时使用专用 E2E 账号和可清理的测试数据，不在生产执行不可逆操作。

### 当前已知实现

- `.github/workflows/ci.yml` 配置了 push-to-main 和 Pull Request CI；GitHub Actions 的 `#404` 已对 `973d9bb` 全绿。
- `.github/workflows/deploy-production.yml` 在 CI 成功的 `main` push 后部署对应 SHA，不部署 PR，也不部署 CI 失败的提交。仓库 Secret `CLOUDCRANE_DEPLOY_SSH_KEY` 已在 GitHub Settings 配置；Deploy production `#1` 已将 `973d9bb` 部署到生产。
- [生产部署手册](cloudcrane-production-deploy.md)记录的是人工 SSH 更新代码、构建、重启和 Nginx 检查，不是自动 CD。
- 2026-09-30 只读检查确认生产主机 `xunmao-sg219` 使用 tmux 会话 `cloudcrane-production` 管理 `web`、`agent`、`gateway`、`runner` 和 `preview` 窗口；对应 systemd unit 当前均 inactive。HTTP 健康检查返回 200，Nginx 配置检查通过。
- `scripts/deploy-production.sh` 为每个版本建独立 git worktree，备份 PostgreSQL，再构建、迁移、重启 tmux 服务并检查 Web、Agent、Workspace、Preview；健康失败时尝试恢复上一应用版本。数据库备份保存在 `/var/backups/cloudcrane/postgres/`，需由运维定期确认备份可恢复及磁盘空间。
- 生产控制 checkout 仍保留在 `57872b3`；自动部署在 `/opt/cloudcrane-releases/<SHA>` 建立运行 worktree，目前服务运行于 `973d9bb`。服务器工作区另有未跟踪的 `docker/compose/docker-compose.server.yml`。该文件属于服务器现状，已保留，部署脚本只读取它来定位 PostgreSQL 容器，不覆盖或清理它。
- SSH 已可连接，但本次没有建立本机 `localhost:3000` 隧道。专用公钥已安装到服务器并限制为部署入口，交互式命令拒绝检查通过；GitHub Actions 私钥 Secret 已保存，首次自动部署认证已成功。

因此，tmux 服务管理、基本健康检查、部署脚本语法、Secret 保存和首次 CI/CD 部署已有实测证据。部署后 Web、Agent、Workspace Gateway、Preview Gateway 内部健康检查以及公开认证/Agent 健康入口均返回成功；内置浏览器只读打开正式首页并检查截图，页面布局正常。数据库备份的恢复流程仍未实测。部署期间需避免人工发布并发操作。代码回滚不会自动撤销数据库迁移。

## 尚待解决的文档冲突与部署问题

- **Gateway 选择**：Tech-03/Tech-07 冻结基线写 Caddy；当前生产入口与 Nginx 运维手册写 Nginx。两者不能同时被当作同一套线上事实。按根 `AGENTS.md` 的架构冲突规则，需由项目负责人决定以哪项为准，再通过明确的架构决策更新基线；本轮不改写冻结文档。
- **网站发布与平台发布**：Tech-03 描述 Website Workspace → Website Production 的产品发布架构；Tech-07 将其列为 MVP 暂不实现；当前 `cloudcrane-production-deploy.md` 发布的是 CloudCrane 平台自身。三者不是同一种“上线”，本文按此区分。
- **Egress 安全状态**：`docker/workspace-pboot/README.md` 标出 Workspace Host egress policy 尚未执行，并要求生产 rollout 前处理；已有生产部署手册却描述正在运行的生产服务。需确认安全策略是否在服务器以仓库外规则落实，或此项仍是生产开放风险。
- **数据库回滚边界**：部署脚本在迁移前生成 PostgreSQL custom-format 备份，并在健康检查失败时尝试恢复上一版应用；它不会自动恢复数据库，以免删除部署后产生的新数据。Schema migration 必须保持旧版本可兼容，恢复数据库需按运维手册人工评估和执行。
- **生产 Compose 配置管理**：服务器存在未跟踪的 `docker/compose/docker-compose.server.yml`。部署脚本读取它发现 PostgreSQL 容器；后续应将服务定义纳入受控配置，同时保留服务器私有参数和密钥在仓库外。

## 当前验收能力限制

- DEVTOOLS MCP 不在本轮可用工具中；本轮使用 Codex 内置浏览器只读检查了正式首页，没有登录或修改数据。
- 本次检查时本机 `3000`、`3001`、`15432`、`4101`、`4102`、`4103` 没有监听，SSH 隧道未建立；本机 `5432` 有 PostgreSQL 进程监听，但本轮没有连接或检查其中的数据。生产服务器 SSH 本身可连接。
- 本机 Docker CLI 不可用，所以本轮没有启动 Compose PostgreSQL、Workspace 容器或真实本地全栈，也没有执行数据库迁移/集成测试。
- 本轮通过 CI-only 占位环境完成 `pnpm build` 和 21 条 migration lineage 检查；Build 未连接本机数据库。本机质量检查可验证代码本身，但不能取代远程数据库、Workspace、Runner、Preview 或线上浏览器链路的验收。

这些是本次检查环境的事实，不应复制成永久服务器配置结论。每次验收前重新检查。
