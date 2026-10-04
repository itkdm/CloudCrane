# CloudCrane 生产入口部署

> **状态（2026-10-01）**：平台 CD 使用 GitHub Actions；`main` CI 成功后部署同一 SHA。Website Production 公网入口已在 ECS 配置为 `*.site.itkdm.com → Nginx → 127.0.0.1:4104 Production Gateway`，Cloudflare DNS-only wildcard A 和 Let's Encrypt wildcard 证书已配置。证书使用 Certbot manual DNS hook 签发，但续期 hook 仍需 Cloudflare DNS API 权限，不能视为自动续期已验证。指定 E2E 账户已获临时 Production 发布权益。可信 PbootCMS 3.2.24 基线已安装并能通过版本检查。CI #458 / Deploy #57 已成功部署 `cfe3fb7`，但第 5 个 Release 的真实重试仍以 `RELEASE_ACTIVATION_FAILED` 失败；日志显示 Pboot 首页 404 被用作启动健康信号。代码当前改为镜像内固定 `/_cloudcrane/health` 探针独立验证 PHP-FPM、Release 文件、共享目录和 SQLite；尚未通过 CI/CD 与真实重试。Production 域名授权与完整 E2E 仍待验证。本文 SSH 命令是手动运维/恢复流程，不要与 workflow 并发发布。

平台入口与 Website Production Gateway 都使用 Nginx。Tech-03 中的 Caddy 是架构目标描述；当前已部署实现由 Nginx 终止 TLS 并反代到 Production Gateway。

部署记录中的生产主机别名为 `xunmao-sg219`（公网 IPv4：`186.244.238.219`）；别名本身不能证明主机地域或云产品。本文没有实时核验 DNS 或 Cloudflare 状态；执行变更前应在 SSH、DNS 和 Cloudflare 控制台分别确认。`itkdm.com` Zone 的 apex 和其他站点记录不属于 CloudCrane：

| 记录 | 类型 | 内容 | 代理 |
| --- | --- | --- | --- |
| `app.itkdm.com` | A | `186.244.238.219` | 已代理 |
| `*.preview.itkdm.com` | A | `186.244.238.219` | 仅 DNS |
| `*.site.itkdm.com` | A | `186.244.238.219` | 仅 DNS |

预期 Web 主站为 `https://app.itkdm.com`；Preview 使用 `https://{previewSlug}.preview.itkdm.com/`；Production 使用 `https://{productionSlug}.site.itkdm.com/`。Production Gateway 从 Host 提取已登记的 Production slug，并只路由到数据库中处于可访问状态的 runtime。apex `itkdm.com`、`www` 以及已有邮件/验证记录不属于 CloudCrane，禁止改写。

## 服务器入口

Nginx 配置模板：

```text
deploy/nginx/cloudcrane-production-sites.conf.template
```

`app.itkdm.com` 经过 Cloudflare 代理。生产 HTTPS server 只信任 Cloudflare 官方
IPv4/IPv6 代理网段提供的 `CF-Connecting-IP`，并将解析后的客户端地址写入
`X-Real-IP` 供 Better Auth 限流使用。Cloudflare 公布的网段会更新；部署或排障时应
对照 [官方 IPv4 列表](https://www.cloudflare.com/ips-v4) 和
[IPv6 列表](https://www.cloudflare.com/ips-v6) 更新 Nginx 配置，并先运行 `nginx -t`。
不要只设 `real_ip_header CF-Connecting-IP` 而不限制受信任的来源网段，否则直连源站的
请求可以伪造该头。主站的 HTTP/HTTPS vhost 也会拒绝非 Cloudflare 来源，避免公开的
源站 IP 绕过 Cloudflare；Preview 使用 DNS-only 记录，仍由自己的 vhost 接受公网流量。

发布包含数据库迁移时，先执行 `pnpm --filter @cloudcrane/db db:migrate`，再执行
`pnpm --filter @cloudcrane/db db:backfill-preview-slugs`。回填完成并确认 `preview_slug`
非空后，才重启 Web、Agent 和 Preview Gateway。

服务器安装位置：

```text
/etc/nginx/sites-available/cloudcrane-production.conf
/etc/nginx/sites-enabled/cloudcrane-production.conf
```

路由关系：

```text
https://app.itkdm.com/              → 127.0.0.1:3000
https://app.itkdm.com/agent/        → 127.0.0.1:4101
https://site-*.preview.itkdm.com/   → 127.0.0.1:4103
https://{productionSlug}.site.itkdm.com/ → 127.0.0.1:4104
```

`/agent/` 反代会去掉路径前缀，WebSocket Upgrade、原始 Host 和 HTTPS 来源会继续传递给 Agent Service。这样浏览器只向同一主域发送 Better Auth Cookie，不需要把认证 Cookie 扩展到其他子域。

## TLS

Cloudflare SSL/TLS 模式为“完全（严格）”。服务器使用 Let’s Encrypt 公开信任证书：

```text
/etc/letsencrypt/live/cloudcrane-itkdm/fullchain.pem
/etc/letsencrypt/live/cloudcrane-itkdm/privkey.pem
```

原证书 SAN 已于 2026-10-01 复核更正：`cloudcrane-itkdm` 只覆盖 `app.itkdm.com` 和 `*.preview.itkdm.com`，不覆盖 `*.itkdm.com`。Production 独立证书为 `/etc/letsencrypt/live/cloudcrane-production-sites/{fullchain,privkey}.pem`，SAN 为 `site.itkdm.com`、`*.site.itkdm.com`，有效期至 2026-12-30。首次申请通过 Cloudflare API 手动创建并在签发后删除 DNS-01 TXT。Certbot 保存的 auth hook 只等待本次人工挑战信号，不能完成无人值守续期；需配置范围仅限 `itkdm.com` 的 DNS Edit Token，并实现/演练安全的自动 hook，或在到期前人工续签。当前不可宣称该证书自动续期可用。证书私钥、DNS Token 和 TXT 验证值禁止提交 Git。

若服务器采用仓库 tmux 验收脚本，脚本会将窗口输出写入 `/var/log/cloudcrane/*.log`；部署时可同步安装仓库轮转模板：

```bash
sudo install -m 0644 deploy/logrotate/cloudcrane /etc/logrotate.d/cloudcrane
sudo logrotate -d /etc/logrotate.d/cloudcrane
```

该策略每日轮转、保留 14 份并压缩，使用 `copytruncate` 兼容现有 tmux `pipe-pane` 文件输出。

部署配置中：

```dotenv
WEB_ORIGIN=https://app.itkdm.com
BETTER_AUTH_URL=https://app.itkdm.com
NODE_ENV=production
NEXT_PUBLIC_AGENT_SERVICE_URL=/agent
PREVIEW_GATEWAY_ORIGIN_TEMPLATE=https://{previewSlug}.preview.itkdm.com/
PREVIEW_HOST_SUFFIXES=preview.itkdm.com
PREVIEW_PUBLIC_PROTOCOL=https
PREVIEW_COOKIE_SECURE=true
PRODUCTION_HOST_SUFFIX=site.itkdm.com
PRODUCTION_GATEWAY_ORIGIN_TEMPLATE=https://{productionSlug}.site.itkdm.com/
PRODUCTION_PUBLIC_PROTOCOL=https
# 生产数据目录与代码目录分离，避免发布代码时覆盖运行时数据。
WORKSPACE_MANAGED_PBOOT_BASE_ROOT=/var/lib/cloudcrane/pbootcms-base
# Production Release 可用的受信任历史基线；部署脚本按 pboot-releases.json 填充。
WORKSPACE_MANAGED_PBOOT_BASE_REGISTRY_ROOT=/var/lib/cloudcrane/pbootcms-bases
TEMPLATE_ARTIFACT_ROOT=/var/lib/cloudcrane/templates
AGENT_SERVICE_INTERNAL_URL=http://127.0.0.1:4101
```

仓库提供的 `scripts/server-acceptance-start.sh` 使用 tmux 启动服务；脚本默认会话名为 `cloudcrane-acceptance`。2026-10-01 通过 SSH 核验，生产主机使用 `cloudcrane-production` tmux 会话管理服务；Production Gateway 监听 `127.0.0.1:4104` 并返回健康状态。Production Gateway 是 tmux 服务，不以 `systemctl is-active cloudcrane-production-gateway` 判断。服务管理方式可能变化，每次发布前应重新确认。仓库另有 systemd unit 模板，详见 [`deploy/systemd/README.md`](../../deploy/systemd/README.md)，模板本身不表示生产主机已启用这些 unit。

```bash
CLOUDCRANE_TMUX_SESSION=cloudcrane-production bash ./scripts/server-acceptance-start.sh
```

## 正式邮件

Resend 已验证 `itkdm.com`，服务器与本地私密配置使用：

```dotenv
AUTH_EMAIL_FROM="CloudCrane <auth@itkdm.com>"
AUTH_REQUIRE_EMAIL_VERIFICATION=true
```

Cloudflare 中保留 Resend 要求的 DNS-only 记录：`resend._domainkey` TXT、`rsend` CNAME 和 `send` CNAME。不要开启这些记录的 Cloudflare 代理；API Key 只能放在 `.env.private.local`。

## 自动发布

`.github/workflows/deploy-production.yml` 只响应 `main` push 对应的 CI 成功事件，并部署同一个 commit。GitHub Actions 使用专用 SSH key；服务器公钥通过 `restrict` 和强制命令限制为部署入口，不能获得交互式 shell 或转发能力。私钥只存放在 GitHub Actions Secret `CLOUDCRANE_DEPLOY_SSH_KEY`。

`scripts/deploy-production.sh` 在独立 worktree 中安装依赖和构建，验证 Nginx 配置；执行 `scripts/install-managed-pboot-bases.sh`，按 `docker/workspace-pboot/pboot-releases.json` 从官方仓库安装缺失的、不可变的历史 Managed Base；设置了 `PRODUCTION_HOST_SUFFIX` 时，还会在 ECS 构建 Runner 使用的 Production Docker image。然后备份 PostgreSQL、运行迁移与 Preview slug 回填、重启 `cloudcrane-production` tmux 会话，并检查 Web、Agent、Workspace Gateway、Preview Gateway 和（启用时）Production Gateway。健康检查失败时会尝试重启上一版应用。数据库备份位于 `/var/backups/cloudcrane/postgres/`；应用回滚不会自动恢复数据库，Schema migration 必须保持应用版本兼容。Production image 由 CI 构建同一 Dockerfile 做验证，再由 ECS CD 构建到 Runner 所用的本机 Docker daemon；CI runner 不会把 Docker image 自动交付到 ECS。

服务器的 `docker/compose/docker-compose.server.yml` 是含内嵌数据库凭据的主机私有文件，自动脚本用它定位 PostgreSQL 容器；应留在服务器并忽略，禁止提交。仓库的 `docker-compose.server.example.yml` 与 `postgres.env.example` 是可提交模板。建议后续把当前内嵌凭据协调迁移到权限为 600 的实际 `postgres.env`；更新已有数据库凭据还需协调 PostgreSQL 角色和应用连接配置，不能只更改 Compose 环境文件。数据库备份恢复流程尚未实测，后续再安排恢复演练。

## Workspace 宿主机隔离

每次正式部署先安装并核验 host-level Metadata deny，再在停止 CloudCrane 服务后确保 Workspace 持久目录使用单独的 ext4 project-quota 文件系统。首次切换会短暂停止平台进程与 Workspace 容器；Workspace 内容先复制，旧目录保留作恢复副本。部署失败时脚本会尝试启动上一版服务。

当前生产验收记录：`9117c3518ab3f79a93b16a3727a7960b349439c2` 已通过 GitHub CI、Docker/Pboot 集成与生产部署。生产主机上的 `/var/lib/cloudcrane/workspaces-quota` 已确认挂载为带 `prjquota` 的 ext4；两个不同 project ID 的容器写入测试确认 16 MiB Workspace 达到硬限后收到 `ENOSPC`，64 MiB Workspace 仍能写入；Runner、Workspace Gateway 和 Production Gateway 健康检查通过。真实 Workspace 容器测试确认 Metadata GET 与 Token PUT 被拒绝、普通 HTTPS 可访问，DOCKER-USER jump 和 REJECT 规则计数通过。首次部署曾因 `quotaon -P -p` 已启用时返回状态码 1 而被 `pipefail` 误判失败；日志检查确认 quota 实际开启，修正状态解析后重部署成功。不要把命令退出码单独当作 quota 状态，需解析 `quotaon -P -p` 输出。

Docker systemd drop-in 和 Metadata oneshot service 已安装并检查生效；本轮没有主动重启 Docker 或整台主机做中断演练，因此 daemon 重启后的自动重放机制尚未经过运行时故障注入。当前主机只读信息报告 `KVM`、DMI vendor `Red Hat`、cloud-init datasource `NoCloud`；公网地址段的 ARIN RDAP 登记组织为 `USCLOUD-INC`。这与早期将主机记作 Alibaba ECS 的假设不一致，但尚不足以确认实际 VPS 产品或其云控制面。Alibaba `100.100.100.200` 和通用 `169.254.169.254` 从宿主机均不可达（HTTP `000`），不能据此判断任一控制面 token-required/hardened 开关。宿主机网络 deny 是已验证的强制边界；查明当前服务商和实例控制面前，不要声称 Alibaba HttpTokens 已配置或已确认缺失。

2026-10-04 复核：重启 `cloudcrane-metadata-deny.service` 后，真实 Workspace 容器和一个新建的 Workspace 镜像容器都无法完成 Metadata GET / token PUT；iptables REJECT 计数各增加 2，普通 HTTPS 仍成功。`scripts/verify-workspace-disk-quota.sh` 在生产主机实际运行通过：16 MiB 配额容器写入超限返回 `ENOSPC`，64 MiB 配额容器写入成功，Runner 与 Production Gateway 健康检查通过，临时目录与 project quota 已清理。`repquota -P -a` 复核现存 Workspace 的 1 GiB 块硬限制和 100,000 inode 限制。此次未重启 Docker daemon 或整台主机。主机 KVM/Red Hat/NoCloud 与 USCloud IP 分配证据，以及 Metadata 控制面仍待服务商身份确认，详见[工程生命周期复核](cloudcrane-development-lifecycle.md#2026-10-04-metadata-控制面适用性仍待确认)。

提交 `64cb3c2169f2d70d9c81763b7d0dd975938058fe` 已通过 CI #542、Production Deploy #141。部署后运行更新版 `scripts/verify-cloudcrane-metadata-policy.sh`：Alibaba Metadata GET、Token PUT 和通用 `169.254.169.254` GET 均失败，三次拒绝均被 iptables 规则计数；绕过代理的 `https://example.com` 请求成功。当前 `cloudcrane-metadata-deny.service` 为 active，DOCKER-USER 的 `br+` hook 与两条 REJECT 规则存在。此次未重启 Docker daemon 或整台主机进行故障注入。

- Workspace Docker bridge 出口在 `DOCKER-USER` 链前段拒绝 `100.100.100.200/32` 和通用 IPv4 link-local `169.254.0.0/16`，覆盖 Alibaba Metadata 与常见 IPv4 Metadata 地址；其它公网 HTTPS egress 保持可用。`cloudcrane-metadata-deny.service` 在 Docker 启动后应用规则，Docker systemd drop-in 也会在每次 Docker 启动后重放规则。
- 真实 Workspace 核验脚本同时探测 Alibaba Metadata GET、Token PUT、`169.254.169.254` GET，并确认三次拒绝都计入 host firewall 规则；同时检查不经代理的公网 HTTPS 连通性。当前生产 Workspace Docker network 的 `EnableIPv6` 为 `false`；若以后启用 IPv6，必须为 IPv6 Metadata 路径补充 host-level deny 和真实容器验证。此策略不代表已确认未知服务商的控制面 token-required 设置；服务商及实例控制面确认后还需按其官方地址与控制项补充验证。
- 规则安装和存在性检查由 `scripts/install-cloudcrane-metadata-policy.sh` 执行。用真实 Workspace 容器验证 Alibaba GET、Token PUT 和通用 link-local GET 均被 host firewall 计数并拒绝，同时检查 `https://example.com` 仍可访问：

  ```bash
  sudo bash ./scripts/verify-cloudcrane-metadata-policy.sh cloudcrane-workspace-<workspace-id>
  ```

- Workspace 数据根目录为 `/var/lib/cloudcrane/workspaces-quota`，由 `/var/lib/cloudcrane/workspaces-quota.ext4` 挂载，ext4 开启 project ID 和 project quota。宿主机保留 30 GiB 总上限，默认每个 Workspace 1 GiB 硬块配额及 inode 硬上限；Agent 写入、Refresh 暂存和 Workspace 内 build cache 均计入。Runner 在创建和恢复容器前为 Workspace tree 设置 project ID 与目录继承标记，并用 `setquota` 设置硬限制；quota 命令失败会阻止 Workspace 创建或恢复。
- `.workspace-project-id` 位于 bind mount 外的 Workspace 元目录，避免 Agent 改写配额编号。销毁 Workspace 后先删除数据，再释放项目配额。
- Reference 上传保存在独立只读挂载下，不计入 Workspace 写配额。Release/template staging 和 Production 存储由 Runner 管理，Agent Bash 不能直接写入；它们不属于本配额，分别依靠制品大小验证与现有保留/垃圾回收策略管理。
- 检查实际挂载和配额：

  ```bash
  findmnt -T /var/lib/cloudcrane/workspaces-quota -no FSTYPE,OPTIONS
  sudo quotaon -P -p /var/lib/cloudcrane/workspaces-quota
  sudo repquota -P -a
  sudo bash ./scripts/verify-workspace-disk-quota.sh
  ```

`repquota -P -a` reports project usage, block limits and inode limits. The `quota -P <project-id> -f <mount>` form is not supported by the deployed quota tools and must not be used to inspect project usage.

不要用 `du`、API 写入检查或容器 overlay 大小冒充硬配额。Metadata token-required/hardened 模式属于云服务商控制面的第二层；查明当前服务商前，不要假设其存在或可配置。无论控制面设置如何，都不能省略宿主机网络 deny。

如果 Workspace 配额挂载不可用，不要启动 Runner 接受 Workspace 工作负载。先确认旧目录和新挂载数据，再恢复 `.env.server.local` 中的 `WORKSPACE_ROOT` 到备份路径，重启服务并检查 Workspace runtime；确认恢复后再处理 quota image，禁止直接删除 `.ext4` 文件。

## 发布与检查

### 线上发布原则

生产验收必须直接访问 `https://app.itkdm.com`，不要把仅用于 ECS 内部联调的
`http://localhost:3000` 当作线上结果。`localhost:3000` 只适用于 SSH 隧道下的
远程服务验收；如果使用它验收，必须显式覆盖 `NEXT_PUBLIC_AGENT_SERVICE_URL` 为
`http://localhost:4101`，因为生产构建中的 `/agent` 依赖 Nginx 的路径反代。

线上切换时只保留一套服务：确认当前进程管理方式和运行目录后，先停止旧服务，再从当前提交构建并启动新服务，最后通过 Nginx 入口检查 Web、Agent、Preview 和 WebSocket。不要同时启动旧目录和新目录的同端口服务，也不要用相对路径启动脚本绕过正式反向代理。

本次线上故障排查得到的关键结论：浏览器请求 `/agent/v1/...` 返回 307 后变成
`/<locale>/agent/v1/...`，说明请求落入 Next 国际化中间件而不是 Nginx 的 `/agent/`
反代。该问题应修正部署入口或 `NEXT_PUBLIC_AGENT_SERVICE_URL`，不能修改会话业务路由
来掩盖反代配置错误。

```bash
cd /opt/cloudcrane
git fetch origin main
git merge --ff-only origin/main
set -a
. ./.env.server.local
. ./.env.private.local
set +a
pnpm build
tmux kill-session -t "${CLOUDCRANE_TMUX_SESSION:-cloudcrane-acceptance}" || true
bash ./scripts/server-acceptance-start.sh
sudo nginx -t
sudo systemctl reload nginx
```

若使用独立发布目录进行构建，切换完成后也必须先确认旧目录服务已停止，再只启动
独立发布目录的一套服务；发布目录中的 `.env.server.local` 和 `.env.private.local`
只能来自服务器私有文件，禁止回显或提交。

必须检查：

```bash
curl -fsS https://app.itkdm.com/api/auth/get-session
curl -fsS https://app.itkdm.com/agent/health
curl -fsS https://site-<websiteId>.preview.itkdm.com/
```

最终 UI 验收使用 DEVTOOLS MCP，直接打开 `https://app.itkdm.com`，检查页面、Network、
Console、认证 Cookie、Agent REST/WS 和 Preview Bridge；不能用本地裸启动的 Web 端口
代替生产入口。验收完成后删除临时测试账号、测试 Website、临时会话和测试数据，保留
数据库备份路径与脱敏部署记录。
