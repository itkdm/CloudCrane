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
- 生产发布采用 CI/CD：`main` 的 push CI 成功后，部署 workflow 将部署同一个已验证 commit，并检查线上健康入口。首次功能提交已端到端验证：CI `#404` 和 Deploy production `#1` 均成功，部署的 SHA 为 `973d9bb4cca32b2d576fa2fc394dc403cf878c7c`。

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

- `.github/workflows/ci.yml` 配置了 push-to-main 和 Pull Request CI；截至 2026-10-01，CI `#452` 对 `e37ef02d` 的质量、数据库迁移、Workspace/Production 镜像构建、Production Docker 集成和远程执行集成全部通过。
- `.github/workflows/deploy-production.yml` 在 CI 成功的 `main` push 后部署对应 SHA，不部署 PR，也不部署 CI 失败的提交。仓库 Secret `CLOUDCRANE_DEPLOY_SSH_KEY` 已配置；Deploy production `#51` 已成功部署 `e37ef02d`，公开认证和 Agent 健康入口检查通过。部署脚本仅在配置 `PRODUCTION_HOST_SUFFIX` 时于 ECS 构建 Production 镜像；该构建条件不表示 Website Production 公网入口已配置。
- [生产部署手册](cloudcrane-production-deploy.md)仍保留人工 SSH 运维/恢复指引；日常发布由上述 CD 自动执行。
- 2026-09-30 只读检查确认生产主机 `xunmao-sg219` 使用 tmux 会话 `cloudcrane-production` 管理 `web`、`agent`、`gateway`、`runner` 和 `preview` 窗口；对应 systemd unit 当前均 inactive。HTTP 健康检查返回 200，Nginx 配置检查通过。
- 当前 CloudCrane 平台公网入口和 Website Production Gateway 均使用 Nginx：Nginx 转发 `app.itkdm.com`、`*.preview.itkdm.com` 和 `*.site.itkdm.com`，配置包含平台 Agent WebSocket Upgrade 头。2026-10-01 已配置 DNS-only `*.site.itkdm.com A → 186.244.238.219`，Production vhost 反代 `127.0.0.1:4104`。原 `cloudcrane-itkdm` 证书只覆盖 `app.itkdm.com` 与 `*.preview.itkdm.com`，有效至 2026-12-17；另签发 `cloudcrane-production-sites` 覆盖 `site.itkdm.com` 与 `*.site.itkdm.com`，有效至 2026-12-30。Production 证书通过一次性手动 DNS hook 签发，Cloudflare DNS Edit 专用 Token 尚未配置，故无人值守续期未完成。
- `scripts/deploy-production.sh` 为每个版本建独立 git worktree，备份 PostgreSQL，再构建、迁移、重启 tmux 服务并检查 Web、Agent、Workspace、Preview；健康失败时尝试恢复上一应用版本。数据库备份保存在 `/var/backups/cloudcrane/postgres/`，需由运维定期确认备份可恢复及磁盘空间。
- 生产控制 checkout 仍保留在 `57872b3`；自动部署在 `/opt/cloudcrane-releases/<SHA>` 建立运行 worktree。首次部署使用 `973d9bb`，随后文档复核提交 `6f3afed` 也经 Deploy production `#2` 部署。服务器工作区另有未跟踪的 `docker/compose/docker-compose.server.yml`。该文件属于服务器现状，已保留，部署脚本只读取它来定位 PostgreSQL 容器，不覆盖或清理它。
- SSH 已可连接，但本次没有建立本机 `localhost:3000` 隧道。专用公钥已安装到服务器并限制为部署入口，交互式命令拒绝检查通过；GitHub Actions 私钥 Secret 已保存，首次自动部署认证已成功。

因此，tmux 服务管理、基本健康检查、部署脚本语法、Secret 保存和 CI/CD 部署已有实测证据。Deploy production `#4` 后，Web、Agent、Workspace Gateway、Preview Gateway 内部健康检查以及公开认证/Agent 健康入口均返回成功。内置浏览器只读打开正式首页：宽屏截图的首屏布局正常；约 910px 的窄视口截图出现横向滚动条，响应式表现仍需专项确认。数据库备份的恢复流程仍未实测。部署期间需避免人工发布并发操作。代码回滚不会自动撤销数据库迁移。

## 尚待解决的文档冲突与部署问题

- **生产入口已配置、整体 E2E 未完成**：Production Gateway、wildcard Nginx 配置模板和 systemd unit 在仓库；生产实际使用 tmux 管理进程。2026-10-01 已配置 `site.itkdm.com` suffix、入口模板、DNS-only wildcard A、TLS 证书和 Nginx vhost；内部 Gateway `/health` 返回 200，公网 HTTP 跳转 HTTPS，未知 slug 返回预期 404。证书自动续期仍缺 Cloudflare DNS Edit 凭据和自动 hook。
- **网站发布与平台发布**：Tech-03 描述 Website Workspace → Website Production 的产品发布；`.github/workflows/deploy-production.yml` 发布的是 CloudCrane 平台自身。Production Publish V1 已实现数据库 runtime/release、manifest/ZIP、安全解压、Production operation dispatch、Runner Docker provider、发布/状态/授权 API 和 Settings UI。指定的线上 `CloudCrane Production E2E` 已获临时 Production 发布权益，网站 Ready 且 Preview 域名 PbootCMS Authorized。首发发现 Workspace 使用官方 PbootCMS 3.2.24（`29ff72ee…`），服务器此前仅有 3.2.26 Managed Base（`8c7ad1da…`）；生成的 `.cloudcrane/bootstrap.json` 也被误判为 Core Drift。`030eb17` 已修复可信历史基线、生成元数据比较和 CD 基线安装。`ab4b855` 为本机健康检查添加规范 Production Host 与 HTTPS 转发头。`9b93564` 修复失败后复用旧 Idempotency-Key 的 UI 重试问题；CI #457 和生产部署 #56 均通过。部署后真实新尝试已进入 Runner 并创建第 4 个 Release，但部署健康检查收到 Pboot 的未授权页面 HTTP 404，导致 `PRODUCTION_HEALTHCHECK_FAILED` 映射为 `RELEASE_ACTIVATION_FAILED`；本次新增窄条件识别：只将正文含 Pboot 明确“未匹配到本域名有效授权码”提示的 404 视为授权待完成的健康 Runtime，普通 404 仍回滚。该修复尚待检查、提交、CI/CD 和线上重试。Preview 授权不代表 Production 域名获授权；Production 官方授权、公网访问、二次发布/数据保留、Release 切换及故障场景仍待验收。
- **Workspace egress 已核实**：2026-10-01 生产主机上的 Workspace 网络为 `bridge` 且 `internal=false`，`DOCKER-USER` 没有自定义规则，UFW inactive；从运行中的 Workspace 请求 `https://example.com` 得到 HTTP 200，因此至少公网 HTTPS 可达，未配置域名级 egress allowlist。Workspace 使用独立网络、容器以非 root 用户运行且未挂载 Docker socket，降低了其他风险，但不等于出站过滤。对 `100.100.100.200:80` 的主机和容器 TCP 探测均超时；没有找到显式阻断规则，因此不能据此证明 ECS metadata 已被策略封锁。Tech-02 允许 V1 按需使用公网，但明确要求阻断 metadata；这台主机目前没有可核实的显式 metadata deny 规则，应作为安全整改项。
- **数据库回滚边界**：部署脚本在迁移前生成 PostgreSQL custom-format 备份，并在健康检查失败时尝试恢复上一版应用；它不会自动恢复数据库，以免删除部署后产生的新数据。Schema migration 必须保持旧版本可兼容，恢复数据库需按运维手册人工评估和执行。
- **生产 Compose 配置管理**：实际的 `docker/compose/docker-compose.server.yml` 含内嵌 PostgreSQL 密码，只应留在服务器并由 `.gitignore` 排除，不能提交真实文件。仓库提供 `docker-compose.server.example.yml` 与 `postgres.env.example` 作为无密钥模板；建议后续将当前内嵌密码协调迁移到权限为 600 的 `docker/compose/postgres.env`。现有数据库密码迁移必须同时处理 PostgreSQL 角色和应用连接配置，不能只改 Compose 环境变量。

## 当前验收能力限制

- DEVTOOLS MCP 不在本轮可用工具中；按项目约定使用 Codex 内置浏览器检查可见 UI 并截屏，无法提供 Network/Console 证据。Production 专用 E2E 发布权益已临时开通。`030eb17`、`ab4b855`、`9b93564` 均已通过线上 CI/CD 部署；当前真实首发证据确认规范 Host 请求已进入 Pboot，未授权页面返回 HTTP 404。Runner 先前只接受 403，导致首发健康检查误判；窄条件识别该 Pboot 404 的修复仍待 CI/CD 和真实重试。公网未知 slug 已验证 HTTP→HTTPS 与 TLS 握手，Production Gateway 返回 404，这不代表已发布站点可访问。Production 域名授权、公网访问、第二次发布、数据保留、Release 切换和故障恢复仍待完整 E2E。此前首页约 910px 窄视口截图可见横向滚动条，响应式表现仍需专项确认。
- 本次检查时本机 `3000`、`3001`、`15432`、`4101`、`4102`、`4103` 没有监听，SSH 隧道未建立；本机 `5432` 有 PostgreSQL 进程监听，但本轮没有连接或检查其中的数据。生产服务器 SSH 本身可连接。
- 本机 Docker CLI 不可用，所以本轮没有启动 Compose PostgreSQL、Workspace 容器或真实本地全栈，也没有执行数据库迁移/集成测试。
- Production Docker CI 使用固定提交的 PbootCMS 3.2.26 启动真实 Workspace 和 Production 镜像。CI 的 Production 端口和访问 IP 每次随机变化，且 CI 不持有可用于该临时域名的官方 Pboot 授权码，因此真实 Pboot 首页应返回“未匹配到本域名有效授权码”并保持 `authorization_required`；这不代表 PHP、SQLite 或镜像启动失败。CI `#452` 已验证真实镜像构建、Pboot 数据库、生产 DB 路径、资源和敏感路径规则，以及第二个 Release 对持久数据的保留。合成 Pboot 夹具验证授权后页面、授权状态及 Release 切换。没有正式授权码时，不把真实 Pboot 首页/后台页面验收写成通过；需要对稳定且已授权域名做单独验收。
- CI `#452` 通过 `pnpm build` 和 23 条 migration lineage 检查；本机没有启动 Docker 全栈，也没有连接本机数据库。该轮还通过线上浏览器对真实发布入口做了可见流程检查，错误提示确认入口配置是当前门槛；这没有验证授权 Pboot 正式页面或已发布 Production 站点。
- Next.js build 在配置收集阶段会导入数据库和认证模块，因此本机缺少 `DATABASE_URL` 时会报 `DATABASE_URL is required`，缺少/过短的 `BETTER_AUTH_SECRET` 时会报认证密钥配置错误；这些是构建环境初始化错误，不代表数据库连接或认证服务失败。本机构建可仅对当前进程设置指向未监听回环端口的占位 PostgreSQL URL（例如 `postgresql://cloudcrane:cloudcrane@127.0.0.1:65432/cloudcrane`）和至少 32 字符的非生产占位 `BETTER_AUTH_SECRET`，再运行 `pnpm build`。构建不会访问该数据库端口或读写数据库；不要用这些占位值验证数据库、网站列表或远程服务状态。GitHub CI 使用隔离的临时 PostgreSQL 与 CI-only 密钥。

这些是本次检查环境的事实，不应复制成永久服务器配置结论。每次验收前重新检查。
