# CloudCrane 日常开发、CI 与发布生命周期

> 历史记录始于 2026-09-30；当前状态更新至 2026-10-04。本文保留按日期记录的运维过程；后续日期的状态修订优先于较早记录，线上健康状态会变化，发布前仍需重新检查。

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
- **网站发布与平台发布**：Tech-03 描述 Website Workspace → Website Production 的产品发布；`.github/workflows/deploy-production.yml` 发布的是 CloudCrane 平台自身。Production Publish V1 已实现数据库 runtime/release、manifest/ZIP、安全解压、Production operation dispatch、Runner Docker provider、发布/状态/授权 API 和 Settings UI。指定线上测试站 `CloudCrane Production E2E` 已获临时 Production 发布权益；Workspace 是官方 PbootCMS 3.2.24（`29ff72ee…`）。用户选择为可信的同版本 Managed Base 建立基线，没有切换到无关的 3.2.26 测试站。`030eb17` 已修复可信历史基线、生成元数据比较和 CD 基线安装；`ab4b855` 为镜像健康检查添加规范 Production Host 与 HTTPS 转发头；`9b93564` 修复失败后沿用旧 Idempotency-Key 的重试入口。此后 Pboot 首页 404 被证实是未授权页面而非健康失败；`cfe3fb7` 开始识别 `authorization_required`，`9e65354` 加入镜像内固定 `/_cloudcrane/health` 探针，`e55859c` 增加安全失败类别日志，`f55e957` 调整探针检查的共享目录权限；CI #461 与 Deploy #60 均通过。2026-10-01 首发最终激活 Release #7（`b8973262-fafe-4167-aaf6-f914b334d3ab`），Runtime 状态 `authorization_required`，探针 HTTP 204；公网域名通过 Nginx/Gateway 转发到站点，但 Pboot 页面因缺正式域名授权码仍返回 404。该测试站的 3.2.24 Preview 设置显示 Authorized，但实际 Preview iframe 显示域名授权无效；Agent Workspace 中首页 `template/default/html/index.html` 的 Release 2 单行改动记为 Workspace commit `7b46550`，Agent 报告 Preview 客户端断开/桥接超时，因此未确认 Preview 可见效果，也尚未执行第二次 Publish。Production 容器重启后保持运行、独立健康探针返回 204；重建停止测试容器时 loopback 端口从 32797 变为 32798，控制库仍保存旧端口导致 502。本轮在核对容器实际映射、Runtime 状态和当前 Release 后，只修正了测试站的 `production_runtime.production_port`，公网 Gateway 随后返回 Pboot 未授权页的 404。CD 已构建新镜像，但已有容器不会自动替换镜像 ID；只重建了这个已停止且网络无 endpoint 的测试容器，保留共享目录。自动镜像升级/回滚策略，以及发布中刷新、响应丢失和 Runner 重启等故障路径仍未完成线上 E2E；授权后的页面、Release #9、数据保留和缓存切换的当前结果见下一条记录。
- **授权后第二次发布进度（2026-10-01）**：用户已在目标 Production 网站设置页提交该正式域名的 Pboot 授权，页面显示网站已上线；授权码未写入文档。Release #8（`804bf341-cc37-4ccc-9856-1784b4694129`）发布并激活后，公网能打开 Pboot 首页，但显示旧副标题。Workspace 和 Release #8 文件均含 `Release 2 验收` 标记；Production SQLite SHA-256 仍为 `0c4b920c…f32e01b`，上传文件数保持 25。CI #463 首次缓存清理实现因宿主权限失败（`EACCES`）；CI #464 已改为一次性、无网络、只读根文件系统容器，并以 UID 1000 清理 `runtime/cache` 和拼写为 `runtime/complile` 的模板缓存。随后 Release #9（`46402805-def5-4959-9d85-a9d0e79a748c`）已在控制库 active，当前 symlink 指向 Release #9，模板源文件也含新标记，但首次公网响应仍是旧副标题。手动再次清理两类缓存并向容器内 PHP-FPM master 发送 graceful reload 后，公网首页立即显示新标记且浏览器 Console 无错误；因此发布还必须在缓存清理后刷新 PHP worker 的 OPcache/路径状态。此项自动化尚待实现和 CI 验证。CI #464 的真实 Docker 集成成功只覆盖了目录清理权限；新测试将验证同一路径的 PHP 文件在 Release 切换后从旧内容更新为新内容。当前站点 Release #9 的 DB SHA-256 仍为 `0c4b920c…f32e01b`，上传文件数仍为 25。Preview 页面此前报告授权无效、Agent Preview bridge timeout 的冲突仍未解决。
- **Workspace egress 与 Metadata 隔离**：2026-10-01 检查时尚无显式 deny 规则；该结论仅代表历史状态。2026-10-04 已安装 `cloudcrane-metadata-deny.service` 和 Docker `ExecStartPost` drop-in，在 `DOCKER-USER` 阻断 Workspace bridge 到 `100.100.100.200/32`，同时保留普通公网 HTTPS。后续复核发现策略未覆盖通用 IPv4 link-local Metadata 地址；已将 `169.254.0.0/16` 加入同一规则链，并扩展真实 Workspace 核验以断言 Alibaba GET、Token PUT 和 `169.254.169.254` GET 均被 host firewall 计数拒绝。当前生产 Workspace Docker network 的 `EnableIPv6` 为 `false`；若启用 IPv6，需先加入 IPv6 host-level deny 与容器验证。Docker daemon 重启后 policy service、DOCKER-USER hook 与拒绝规则已实测恢复，容器仍运行且 Web/Agent 健康检查通过；重启后再次执行的 Workspace probes 与公网 HTTPS 核验也通过。整机重启故障注入及服务商控制面是否提供 token-required 等价选项仍待确认。安装、核验与限制见[生产部署说明](cloudcrane-production-deploy.md)；此前超时探测不能作为策略证据。
- **数据库回滚边界**：部署脚本在迁移前生成 PostgreSQL custom-format 备份，并在健康检查失败时尝试恢复上一版应用；它不会自动恢复数据库，以免删除部署后产生的新数据。Schema migration 必须保持旧版本可兼容，恢复数据库需按运维手册人工评估和执行。
- **生产 Compose 配置管理**：实际的 `docker/compose/docker-compose.server.yml` 含内嵌 PostgreSQL 密码，只应留在服务器并由 `.gitignore` 排除，不能提交真实文件。仓库提供 `docker-compose.server.example.yml` 与 `postgres.env.example` 作为无密钥模板；建议后续将当前内嵌密码协调迁移到权限为 600 的 `docker/compose/postgres.env`。现有数据库密码迁移必须同时处理 PostgreSQL 角色和应用连接配置，不能只改 Compose 环境变量。

## 当前验收能力限制

- DEVTOOLS MCP 不在本轮可用工具中；按项目约定使用 Codex 内置浏览器检查可见 UI 并截屏，无法提供 DEVTOOLS 的 Network/Console 证据。本轮浏览器截图确认 Website Settings 显示 Ready、Preview 设置显示 Authorized、Production Runtime 显示 `authorization_required`；截图不证明 Preview 或正式站授权后页面可见。公网 Production 域名已分别经本机 ECS Gateway、Nginx vhost 和公网请求验证，当前均返回 Pboot 未授权页的 404。官方 Production 授权码仍须由用户在设置页输入；当前 Preview 客户端/桥接失败且嵌入内容显示域名授权无效，是第二次发布的前置验收阻塞。旧容器镜像漂移尚无自动替换策略；容器重启只实测 Docker restart，Runner 重启和 Docker daemon 主机重启未实测。此前平台首页约 910px 窄视口截图可见横向滚动条，响应式表现仍需专项确认。
- 本次检查时本机 `3000`、`3001`、`15432`、`4101`、`4102`、`4103` 没有监听，SSH 隧道未建立；本机 `5432` 有 PostgreSQL 进程监听，但本轮没有连接或检查其中的数据。生产服务器 SSH 本身可连接。
- 本机 Docker CLI 不可用，所以本轮没有启动 Compose PostgreSQL、Workspace 容器或真实本地全栈，也没有执行数据库迁移/集成测试。
- Production Docker CI 使用固定提交的 PbootCMS 3.2.26 启动真实 Workspace 和 Production 镜像。CI 的 Production 端口和访问 IP 每次随机变化，且 CI 不持有可用于该临时域名的官方 Pboot 授权码，因此真实 Pboot 首页应返回“未匹配到本域名有效授权码”并保持 `authorization_required`；这不代表 PHP、SQLite 或镜像启动失败。CI `#452` 已验证真实镜像构建、Pboot 数据库、生产 DB 路径、资源和敏感路径规则，以及第二个 Release 对持久数据的保留。合成 Pboot 夹具验证授权后页面、授权状态及 Release 切换。没有正式授权码时，不把真实 Pboot 首页/后台页面验收写成通过；需要对稳定且已授权域名做单独验收。
- CI `#452` 通过 `pnpm build` 和 23 条 migration lineage 检查；本机没有启动 Docker 全栈，也没有连接本机数据库。该轮还通过线上浏览器对真实发布入口做了可见流程检查，错误提示确认入口配置是当前门槛；这没有验证授权 Pboot 正式页面或已发布 Production 站点。
- Next.js build 在配置收集阶段会导入数据库和认证模块，因此本机缺少 `DATABASE_URL` 时会报 `DATABASE_URL is required`，缺少/过短的 `BETTER_AUTH_SECRET` 时会报认证密钥配置错误；这些是构建环境初始化错误，不代表数据库连接或认证服务失败。本机构建可仅对当前进程设置指向未监听回环端口的占位 PostgreSQL URL（例如 `postgresql://cloudcrane:cloudcrane@127.0.0.1:65432/cloudcrane`）和至少 32 字符的非生产占位 `BETTER_AUTH_SECRET`，再运行 `pnpm build`。构建不会访问该数据库端口或读写数据库；不要用这些占位值验证数据库、网站列表或远程服务状态。GitHub CI 使用隔离的临时 PostgreSQL 与 CI-only 密钥。

这些是本次检查环境的事实，不应复制成永久服务器配置结论。每次验收前重新检查。

### 2026-10-01 Production E2E 后续进展

本节更新上面的历史检查记录，以此处为准：目标 Production 测试站已提交正式域名授权并显示上线；当前 Release #12（`e16c5b4e-1efc-4ded-b35b-7be034229dfe`）为 active，公网首页显示 Workspace 的 `Release 2 验收` 标记。SQLite SHA-256 保持 `0c4b920c…f32e01b`，上传文件数保持 25。发布中刷新浏览器、发布完成后离开 Settings 丢弃 Web 响应两种情形下，发布操作都在后台完成，分别留下 Release #11 和 #12；重新访问页面可读回完成状态。

Production 容器被替换/重建（不是单纯 `docker restart`）时，Docker 曾将 loopback 端口从 `32798` 改为 `32799`，而控制库仍记旧端口，导致 Gateway 502。核对实际容器映射、active Release 和探针后，只更新测试站对应的 `production_runtime.production_port`，公网站点恢复。随后 Runner 增加了在站点 Production root 持久化 `.production-port`、容器重建时优先复用，以及 Production 状态 API 回写 Runner 实际端口的实现；部署后的真实重启结果见下一节。旧章节关于“授权仍待输入”“第二次发布未执行”“缓存修复尚未自动化”的描述已过期，以本节和此前已记录的 Release #10–#12 结果为准。

### 2026-10-02 部署后 Production 容器重启验证

提交 `399d8764` 的 CI #466 与 Deploy #65 成功；ECS `cloudcrane-production` tmux 中 Runner 窗格存在，测试站重启前容器运行于 `127.0.0.1:32799`，Runtime 为 active / Release #12（`e16c5b4e-1efc-4ded-b35b-7be034229dfe`），公网首页 HTTP 200、固定健康探针 HTTP 204。

对唯一目标容器执行 `docker restart` 后，Docker 将动态 loopback 端口从 `32799` 改为 `32800`。容器仍为 running，容器内首页返回 200、`/_cloudcrane/health` 返回 204，但控制库仍记 `32799`，所以公网 Gateway 暂时返回 502。Production root 中没有 `.production-port` 文件；这说明该现存 Runtime 尚未经过新代码的状态查询/端口元数据初始化，容器重启本身不会触发端口同步。随后只将 E2E 测试站 `production_runtime.production_port` 更新为实测的 `32800`，公网首页恢复 200、探针恢复 204。Release #12、SQLite SHA-256（`0c4b920c…f32e01b`）和上传文件数（25）均未变化。

首次尝试时，长时间复用的内置浏览器标签仍显示另一测试站“模板广场 E2E 验证”的旧 Settings 弹窗；新建干净标签后，目标 `CloudCrane Production E2E` 的 Settings 正确显示 Ready、已授权和正式域名，因此此前现象不是已证实的站点 ID 映射缺陷。用干净标签执行一次正常 Republish 后，Release #13（`c3907824-fca3-4aa6-81ed-32571e7fa54e`）成功激活，Production root 生成 `.production-port`，值为 `32800`；当前 Runtime 为 active，控制库端口与容器映射一致。公网首页再次显示 `Release 2 验收`，HTTP 200；探针 HTTP 204；SQLite 哈希仍为 `0c4b920c…f32e01b`，上传文件数仍为 25。

Release #13 发布并生成 `.production-port=32800` 后，为直接验证自动端口同步，我仅把 E2E 测试站控制库端口暂时改回旧值 `32799`，随即从干净页面再次 Republish。界面从 Publishing 返回 `Website is live`，公网首页仍为 HTTP 200、探针 HTTP 204。Production Gateway 每个请求都会重新读取 Runtime 数据库行；测试容器实测只监听 `32800`，因此旧端口仍被使用时公网不可能返回 200。这一公网 E2E 结果证明自动流程已恢复正确路由，没有进行第二次手工数据库修正。随后 SSH 连续超时，无法直接读取并记录 Runtime 行、最终 Release ID 或 `.production-port` 文件，因此没有获得数据库侧的独立确认。当前 DEVTOOLS MCP 不可用；内置浏览器截图确认正式首页，但 Network/Console 证据未取得。CI 部署时 Runner 已随服务栈重启，tmux Runner 窗格仍存在，但尚未进行独立 Runner 重启故障注入。容器重建后是否复用 `.production-port`、自动镜像滚动升级/回滚和证书自动续期仍待验证或实现。

### 2026-10-02 Production 固定端口与重启复验

本节补充并更新上面关于容器重建和端口的历史记录。提交 `c5c1624` 固定新建 Production 容器的 loopback HostPort，并在重建时读取 `.production-port`；首次 GitHub CI #469 的 Docker 集成测试因容器重启后立即发请求遇到 `ECONNRESET`。提交 `239b7fd` 让测试先等待 `/_cloudcrane/health` 返回 204，再检查原端口、Release 页面和 Runtime 健康。CI #470 的 quality 与 docker-integration jobs 均通过；Deploy production #69 成功部署同一提交。

部署后，目标 `CloudCrane Production E2E` 仍运行在旧的动态绑定容器（HostConfig `HostPort=0`，当时映射 `127.0.0.1:32801`），而 `.production-port` 为 `32801`。我只移除了该站点有明确 website ID 标签的容器和专属空网络，没有删除或改写宿主机 Production root。SQLite 文件 `shared/data/cloudcrane.db` 的 SHA-256 仍为 `0c4b920c6ff000b1fc8e858e283d3c9a98c326ea39d0721934a94d9e1f32e01b`，上传文件数为 25。之后从目标站点 Settings 使用正常 Republish；新容器的 HostConfig 与运行时实际映射都固定为 `127.0.0.1:32801`，与 marker 一致，公网首页 HTTP 200、`/_cloudcrane/health` HTTP 204，Settings 显示 `Website is live`。

对新建容器再单独执行 `docker restart`，等待本机探针恢复后，HostConfig 和实际映射仍为 `32801`；Production marker、SQLite 哈希和 25 个上传文件均未变化；公网首页仍 HTTP 200、健康探针仍 HTTP 204。内置浏览器刷新后的截图显示首页与 `Release 2 验收` 副标题正常。DEVTOOLS MCP 不可用，因此没有 Network/Console 面板证据；截图与外部 HTTP 状态只证明可见页面和响应状态。

Deploy production #69 会按现有发布流程重启平台 tmux 服务栈（包括 Runner）；部署结束后、删除测试容器之前，该站点公网首页和探针仍分别返回 200/204。这证明网站容器及持久数据在平台服务重启后仍可用，但未单独对 Runner 进程执行故障注入。当前已验证平台服务部署重启后的站点可用、Production 容器重建复用固定端口、Production 容器单独重启后公网恢复；Docker daemon/ECS 主机重启、自动镜像滚动升级/回滚以及证书自动续期仍未验收。

### 2026-10-03 Production Refresh 与 CMS 能力 CI/部署验证

CI #497（commit `5490c09`）的质量和 Docker 集成作业均通过。Docker 集成实际运行了 PbootCMS Production 发布、Production → Workspace 内容刷新、Workspace 内容更新后再次发布、数据保留及 Release 检查。第一次 CI #496 暴露测试在 Refresh 重启 Workspace 后继续复用旧 Daemon 客户端；测试现在会重新获取 endpoint 后验证 Refresh 结果。

同一提交的 Deploy production #96 在 ECS 执行 Web 构建时以退出码 137 失败，发生在数据库备份、迁移和服务重启之前，故该次部署没有切换线上应用。只读检查当时主机约 3.8 GiB RAM、无 Swap，构建期间服务器负载偏高。部署脚本已改为 `pnpm exec turbo run build --concurrency=1`，串行执行 Turbo build 任务以降低并发峰值内存；后续需由 Deploy workflow 确认服务器构建及健康检查通过，再记为已上线。不要将服务器退出码 137 与应用构建代码错误混为一谈，也不要手动清理或覆盖 `/opt/cloudcrane-releases/<SHA>` 未完成 worktree；重试应让部署脚本复用同一目标 SHA 并按日志检查构建结果。

### 2026-10-03 PbootCMS 3.2.24 Production 兼容性确认

目标 `CloudCrane Production E2E` 的 Workspace 使用官方 PbootCMS 3.2.24，精确来源为受信任提交 `29ff72ee5afc9c6553b949f04d3fc99443879f40`。受管 Production 基线默认镜像使用 3.2.26，并不意味着现有 3.2.24 Workspace 必须重建或升级。CI #504（`42d60be`）增加了官方固定来源的 3.2.24 Workspace 镜像，并在临时 Docker 环境对 3.2.24 完整运行 Publish、Production CMS 读写、内容编辑冲突检测、Production → Workspace Refresh、Preview 授权字段保留和第二次 Publish；原有 3.2.26 Production 集成也通过。CI #504 的 quality 与 docker-integration 均通过，Deploy production #103 已将该提交部署到 ECS。

首次发布后、未写入测试授权状态时，3.2.24 的 Pboot 首页对不匹配的临时测试域名返回 404；3.2.26 对应返回 403。这是两个版本的页面响应差异，不能单独用来判断 PHP/Production Runtime 不可用；容器服务健康应看固定 `/_cloudcrane/health` 探针。随后 CI 仅在临时容器写入 CloudCrane 测试授权标记以继续验证 CMS adapter 和 Refresh；这不验证 Pboot 官方授权码本身。该集成测试不连接或修改线上 Website、数据库、授权码或内容。

结论：继续使用现有 3.2.24 站点，不因 3.2.26 受管基线而重建，也不自动升级 PbootCMS。未来需升级时，应作为单独迁移评估处理，保护既有 Production DB、Uploads 和官方授权状态。

### 2026-10-04 CMS Content Create 线上 E2E 复验

首轮排查时仓库基线为 `0a45493b`。GitHub [CI #513](https://github.com/itkdm/CloudCrane/actions/runs/37149400191) 和 [Deploy production #112](https://github.com/itkdm/CloudCrane/actions/runs/37149972133) 均成功；CI Docker 集成覆盖 PbootCMS 3.2.24/3.2.26，但尚未证明目标线上站的 Agent E2E。

对目标 `CloudCrane Production E2E` 的 UI 操作到 CMS 只读工具后，类别、内容和公司信息查询均返回 `CMS_OPERATION_FAILED`。Runner 与 Production Gateway 健康检查正常；脱敏结构化日志确认 Runner 执行 CMS helper 失败。Agent 没有调用 Create，没有写入或更改线上 CMS 内容。

只读服务器检查确认目标容器仍基于旧镜像 ID `f4004062…`，而服务器当前镜像 tag 已指向 `8afbf096…`；旧容器内缺少 `cloudcrane-pboot-cms`，当前镜像包含该 helper。根因是 CI/CD 更新服务器镜像 tag 不会自动替换既有 Website Production 容器。该问题与 PbootCMS 3.2.24 版本无关；不需要重建 Website、升级 PbootCMS 或替换数据库。

提交 `de9511d` 为单站显式 `production.ensure` 加入镜像漂移替换和中断恢复。替换只发生在该 Website 的 Publish 流程，不会因平台 CD 或 Runner 启动批量替换现有站点；它复用原 loopback port 与持久挂载，检查 CMS helper 和健康探针，失败时恢复旧容器。GitHub [CI #515](https://github.com/itkdm/CloudCrane/actions/runs/37153680975) 的 quality 与 docker-integration 均通过，[Deploy production #114](https://github.com/itkdm/CloudCrane/actions/runs/37154170756) 成功。负责人授权后通过内置浏览器对目标站执行一次 Republish；ECS 只读核实新旧 image ID 一致、容器 running 且 CMS helper 存在。Settings 显示 `Website is live`，Production 公网首页正常呈现 PbootCMS 页面。不需要重建 Website 或替换数据库。

随后从 Production 实时读取 11 个栏目，并在已启用列表栏目 `scode=3` 创建状态 `0` 草稿：内容 ID `18`，标题 `CloudCrane CMS Create E2E 0a45493`。首次调用返回 `replayed=false`；`cms_get_content` 复核的 ID、标题、正文、栏目、状态和版本与 Create 响应一致。`workspaceContentStale=true`，符合 Production 是内容源、Workspace 需显式 Refresh 的单向数据流。未使用 Bash 或直接 SQL，也未改动既有内容、代码、模板、授权或 Release。浏览器刷新后验收消息仍保留；Console 0 条 warning/error。内置浏览器未提供本次所需的 Network 证据，未使用 DEVTOOLS MCP，因此 Network 面板未验证。

CI Docker integration 同时验证 Create 的持久幂等：模拟数据库已提交但响应为 `UNKNOWN_RESULT`，重启容器后用原 idempotency key 和完全相同 payload 重试，结果 replay 且只存在一条草稿；同一 key 换 payload 返回 `IDEMPOTENCY_KEY_REUSED`。CMS 更新缓存测试验证更新提交后清理失败返回 `UNKNOWN_RESULT`，同 version/patch 重试会 replay 并再次清缓存。真实 Pboot HTTP 页面缓存断言第一次 CI #516 因夹具 Host 错用 Preview 域名返回 403，在缓存断言前失败；随后改用 Production canonical Host，并在 [CI #528](https://github.com/itkdm/CloudCrane/actions/runs/37175897941) 的 Docker integration 中通过。线上 Create 本次为首次响应成功，没有在线模拟响应丢失；持久幂等/丢响应证据来自 CI Docker integration。视觉证据截图保存在本机 `C:\Users\33174\.codex\visualizations\2026\10\04`，不加入仓库。

### 2026-10-04 Production CMS 更新与公网缓存 E2E

在专用 `CloudCrane Production E2E` 网站上预热公开内容详情页 `/?company/4.html`，页面标题为 `PbootCMSV1.0.0正式发布`。通过 Production CMS 语义工具确认内容 ID `4`、状态 `1`，只将标题改为唯一临时标记 `CloudCrane Cache E2E 20261004 408a675`。紧接着用内置浏览器刷新同一公网 URL，页面标题立即显示新标记，证明 CMS 内容更新后 Pboot 公网页面缓存已失效。之后用 Production CMS 语义工具以当前版本作为 `expectedVersion` 恢复原标题；CMS 读回确认状态仍为 `1`，版本指纹恢复为更新前相同值，公网刷新也恢复原标题且不再包含测试标记。其他内容字段未修改；未写 Workspace、未使用 Bash/SQLite/文件工具、未更改代码/模板/Release/授权。内置浏览器验证了可见页面和刷新结果；Network 面板证据未取得。临时写入和恢复均成功，没有发生 `UNKNOWN_RESULT`；CMS 更新语义没有暴露自定义 `idempotencyKey` 参数，本次使用版本校验。

随后补充 Docker 回归断言：CMS cache invalidation 清掉过期页面缓存哨兵后，仍保留 `runtime/session`、`runtime/image`、共享 `data` 与 `upload` 下的哨兵文件。[CI #530](https://github.com/itkdm/CloudCrane/actions/runs/37176910119) 的 quality 与 docker-integration 均通过，新断言实际运行成功；至此 CMS 更新缓存逻辑、失败后幂等重试、真实 Pboot 页面缓存与持久数据保留都有 CI 和专用线上 E2E 证据。Issue #3 已关闭。线上复验工具为 Codex 内置浏览器；DEVTOOLS MCP 不可用，因此没有 Network 面板证据。

### 2026-10-04 Workspace Host 隔离状态复核

早期“尚无 Metadata deny”记录反映 2026-10-01 当时状态，已被后续部署修复取代。按 [生产部署手册](cloudcrane-production-deploy.md) 的后续记录，`9117c351` 已在生产主机安装 Metadata host-level deny，并将 Workspace 持久目录迁至带 ext4 project quota 的独立文件系统；真实容器验证了 Metadata GET/Token PUT 被拒绝、普通 HTTPS 可访问及每个 Workspace 的硬配额限制。这些当前状态不要再从本节前面的 2026-10-01 历史记录推断。

### 2026-10-04 CMS Media Upload V1（部署完成；图片附件公网 E2E 通过）

基于 `92ec3089` 实现 Agent 当前消息图片附件到 Production CMS 的单向上传。后台直接上传的 Production 图片沿用现有路径；对话附件只有在用户明确要求用于正式站时才上传。图片限制为 JPEG/PNG/WebP、不超过 5 MiB、单边不超过 10000 像素且总像素不超过 16 MP；Production 会重新编码，并把超过 8 MP 的图片等比缩小到不超过 8 MP 后保存到共享 uploads。数据库只留幂等摘要和结果路径，不保存图片字节，Refresh 时剔除操作账本但正常回流文件。上传未引用的媒体不触发页面缓存失效。改动提交为 `6a1e717`，其后的 Docker 集成发现 HTTP 静态图片请求返回 403：写入端把 `/static/upload/...` 整段追加到了共享 upload 根目录，但容器内 `/site/current/static/upload` 已经是指向 `/site/shared/upload` 的符号链接。修复提交 `fb24ca9` 后，写入位置改为共享根下的 `image/cloudcrane/...`，公开 URL 仍为 `/static/upload/image/cloudcrane/...`；重放路径同时校验账本路径格式、hash 前缀和目录没有符号链接。

本机 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 与 `git diff --check` 通过；本机没有 Docker/PHP，因此本地 Runner 集成测试显示 skipped，不能用它证明容器内 PHP、共享挂载或公网静态文件可用。本次 GitHub Actions [CI #532](https://github.com/itkdm/CloudCrane/actions/runs/37179636491) 的 Docker 集成正是发现上述 403 的地方；修复后的 [CI #533](https://github.com/itkdm/CloudCrane/actions/runs/37180233523) quality 与 docker-integration 均通过，覆盖 Production 图片经 HTTP 读取及容器重启后的同 key 幂等重放。随后 [Production Deploy #132](https://github.com/itkdm/CloudCrane/actions/runs/37180704537) 成功部署 `fb24ca9`，公网 `/api/auth/get-session` 与 `/agent/health` 检查通过。**今后涉及 Docker、PHP 扩展、bind mount、Nginx 静态路径或运行时权限时，即使本机纯单元测试通过，也必须等 GitHub Docker integration 和部署后的线上健康检查；不要把本机 skipped 写成验证通过。**

在线 Agent 附件验收期间，第一次调用发现专用网站的 Production 容器仍运行旧镜像，尚不认识 `cms.media.upload`；在专用 E2E 网站执行 Republish 后，容器升级至当前 Production 镜像。随后用户提供的 JPEG 为 2924×2775（8.1141 MP），被旧的未文档化 8 MP 拒绝阈值拦截，尚未写入文件或账本。修复将输入上限定为 16 MP，超过 8 MP 时等比缩小。GitHub Actions [CI #535](https://github.com/itkdm/CloudCrane/actions/runs/37183707680) 的 quality 和 docker-integration 均通过，Docker 集成使用 2924×2775 PNG 验证缩放后不超过 8 MP 且公开静态路径返回 200；[Production Deploy #134](https://github.com/itkdm/CloudCrane/actions/runs/37184183564) 部署 `f66ecdb` 并通过公网健康检查。部署后再次在专用 `CloudCrane Production E2E` 网站执行 Republish，并在新的 Agent 对话中附上同一 JPEG。Agent 的 `cms_media_upload` 工具返回 `image/jpeg`、1,079,802 字节、`replayed: false`；随后通过内置浏览器打开其 Production 公网路径，图片成功渲染，浏览器报告尺寸 2903×2755。Agent 工具后最终文字回复在当时仍处于生成状态；工具卡片已明确显示完成且返回成功，未再次提交上传。截图在内置浏览器中截取并目视检查，DEVTOOLS MCP 不可用，因此没有 Network 面板证据。

随后用用户给定的本地 JPEG（896,744 字节，文件签名为 JPEG）在同一 Production E2E 对话发送为当前消息附件，UI 显示附件已附加并开始 Agent 运行。Agent 最终显示 `Run could not be completed`（2 steps）；没有出现 `cms_media_upload` 成功卡片、公开 URL 或完成回复。为避免重复写入，没有再次发送或重试，因此这次图片是否落入 Production CMS 尚未验证，不能据附件上传成功推断 CMS 媒体上传成功。失败状态截图保存在本机 Codex visualizations 目录，未提交到仓库。

### 2026-10-04 CMS Category Create V1 实现与线上验收

沿用产品定义中已有的 `cms.category.create` 能力，补上受信任 Production CMS adapter 和 Agent 工具。第一版只在已启用列表栏目下创建子栏目，继承父栏目的模型和模板，不开放单页、模型配置、任意 Pboot 字段或 SQL。默认状态为隐藏；操作持久化幂等，缓存清理失败返回可重试的 `UNKNOWN_RESULT`，Refresh 不把生产幂等账本带回 Workspace。

提交 `0069b41763e0967ef28483a952c7db0e78ac37cb` 的 GitHub [CI #37186937287](https://github.com/itkdm/CloudCrane/actions/runs/37186937287) 与 [Production Deploy #37187354588](https://github.com/itkdm/CloudCrane/actions/runs/37187354588) 均通过；Docker 集成覆盖 Production CMS category create 与 PbootCMS 3.2.24/3.2.26。首次线上尝试中，`CloudCrane Production E2E`（Website `0d173aae-2ae4-422d-87de-930d63d3c775`）栏目读取成功，但创建返回 `Unsupported CMS operation`。只读检查发现平台 `cloudcrane-production-pboot:v1` 已更新，而该站既有容器仍使用旧 image ID。对专用测试站执行 Republish 后，容器恢复运行且 image ID 与最新镜像一致；没有重建网站或更换数据库。

随后通过内置浏览器 Agent 对已启用列表栏目 `scode=2`（新闻中心）创建隐藏子栏目 `cc000001`，名称 `CloudCrane Category E2E 0069b41`、父编码 `2`、模型 `list`、状态 `0`、filename 未设置；创建后的栏目列表读取工具也已完成。浏览器截图目视确认创建响应字段与页面布局。DEVTOOLS MCP 未用于本轮验证，因此没有 Network 面板证据。第一次失败未产生写入；没有修改既有内容、启用栏目、使用 Bash 或直接 SQL。

### 2026-10-04 Metadata 控制面适用性仍待确认

Workspace 容器到 `100.100.100.200/32` 的宿主机 deny、规则服务重启恢复和公网 HTTPS 连通性已有实测记录。提交 `64cb3c2` 将 `169.254.0.0/16` 加入宿主机 deny，并扩展真实 Workspace verifier 覆盖 `169.254.169.254`。CI #542 与 Deploy #141 已通过；生产 Workspace verifier 实测 Alibaba GET、Token PUT 和 `169.254.169.254` GET 均触发 host firewall REJECT 计数，直连公网 HTTPS 成功；policy service 为 active 且 DOCKER-USER bridge hook 存在。随后重启 Docker daemon，systemd service 与 Docker ExecStartPost 均完成规则恢复；Workspace、Production、PostgreSQL 容器均保持运行，Web 与 Agent 健康检查返回 HTTP 200；daemon 重启后的 Workspace metadata probes 与公网 HTTPS 核验也通过。只读检查还确认当前 Workspace Docker network `EnableIPv6=false`。进一步检查发现当前生产主机报告 `KVM`、DMI vendor `Red Hat`、cloud-init datasource `NoCloud`；公网地址段的 ARIN RDAP 登记组织为 `USCLOUD-INC`。这些证据与 Tech-03 文档中的“阿里云 ECS”假设不一致，但不能单独确定实际 VPS 产品、上游云控制面或其 Metadata 配置能力。此前宿主机和 Workspace 对 Alibaba `100.100.100.200` 及通用 `169.254.169.254` 的请求均未建立连接（HTTP `000`），这只说明当时探测路径不可达，不能证明控制面 token-required 状态。第一次整机重启后，systemd / Docker hook 恢复网络隔离规则，Production 与 PostgreSQL 容器自行启动；tmux 管理的平台进程需重新运行 `scripts/server-acceptance-start.sh`。该次也发现既有 Workspace 容器未设置 Docker restart policy。提交并部署 `5ef0bcc` 后，Runner 对兼容的既有容器原地应用 `unless-stopped`；第二次整机重启确认 Workspace 自动运行且策略保持生效。恢复 tmux 平台服务后，Web、Agent、Runner 和各 Gateway 健康检查均通过，真实 Workspace metadata verifier 的三类拦截和公网 HTTPS 检查也通过。云厂商 Metadata 控制面仍待服务商身份确认。

因此，Issue #6 的宿主机网络隔离部分已有验证；云厂商控制面是否存在、以及是否支持等价的 token-required/hardened 模式，仍需先确认服务商/实例控制台身份，再按该服务商的权威设置核验。不要把当前主机称作已核实的阿里云 ECS，也不要把 Alibaba `HttpTokens` 设置描述为已配置或已确认缺失。继续保留对 Workspace bridge 的 host-level deny，直到查明此主机实际提供的 Metadata 服务和控制面边界。
