# CloudCrane 生产入口部署

> **发布方式状态（2026-09-30）**：仓库已新增 GitHub Actions 自动部署 workflow，`CLOUDCRANE_DEPLOY_SSH_KEY` Secret 已配置；本轮 push 后等待首次部署验证。首次验证完成前，推送 `main` 尚不能视为自动上线已验收。本文下面的 SSH 命令仍是手动发布流程；不要与 workflow 并发发布。

部署记录最近一次记录的新加坡服务器为 `xunmao-sg219`（公网 IPv4：`186.244.238.219`）。本文没有实时核验服务器、DNS 或 Cloudflare 状态；执行变更前应在 SSH、DNS 和 Cloudflare 控制台分别确认。`itkdm.com` Zone 的 apex 和其他站点记录不属于 CloudCrane：

| 记录 | 类型 | 内容 | 代理 |
| --- | --- | --- | --- |
| `app.itkdm.com` | A | `186.244.238.219` | 已代理 |
| `*.preview.itkdm.com` | A | `186.244.238.219` | 仅 DNS |

预期 Web 主站为 `https://app.itkdm.com`；Preview 使用 `https://{previewSlug}.preview.itkdm.com/`。slug 是数据库持久化的 12 位小写字母数字串。apex `itkdm.com`、`www` 以及已有邮件/验证记录不属于 CloudCrane，禁止改写。

## 服务器入口

Nginx 配置模板：

```text
deploy/nginx/cloudcrane-production.conf
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
```

`/agent/` 反代会去掉路径前缀，WebSocket Upgrade、原始 Host 和 HTTPS 来源会继续传递给 Agent Service。这样浏览器只向同一主域发送 Better Auth Cookie，不需要把认证 Cookie 扩展到其他子域。

## TLS

Cloudflare SSL/TLS 模式为“完全（严格）”。服务器使用 Let’s Encrypt 公开信任证书：

```text
/etc/letsencrypt/live/cloudcrane-itkdm/fullchain.pem
/etc/letsencrypt/live/cloudcrane-itkdm/privkey.pem
```

证书覆盖 `app.itkdm.com`、`*.itkdm.com` 和 `*.preview.itkdm.com`。当前证书通过 DNS-01 手动申请，不能依赖 Certbot 默认定时器自动续期；到期前必须配置 Cloudflare DNS API 最小权限 Token 与 `--manual-auth-hook`，或重新执行 DNS-01。证书私钥、DNS Token 和 TXT 验证值禁止提交 Git。

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
# 生产数据目录与代码目录分离，避免发布代码时覆盖运行时数据。
WORKSPACE_MANAGED_PBOOT_BASE_ROOT=/var/lib/cloudcrane/pbootcms-base
TEMPLATE_ARTIFACT_ROOT=/var/lib/cloudcrane/templates
AGENT_SERVICE_INTERNAL_URL=http://127.0.0.1:4101
```

仓库提供的 `scripts/server-acceptance-start.sh` 使用 tmux 启动服务；脚本默认会话名为 `cloudcrane-acceptance`。2026-09-30 通过 SSH 只读核验，生产主机使用 `cloudcrane-production` 会话，其中有 `web`、`agent`、`gateway`、`runner` 和 `preview` 窗口；对应 systemd unit 当时均 inactive。该状态可能变化，每次发布前应重新确认。仓库另有 systemd unit 模板，详见 [`deploy/systemd/README.md`](../../deploy/systemd/README.md)，该模板本身不表示生产主机已启用这些 unit。

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

`scripts/deploy-production.sh` 在独立 worktree 中安装依赖和构建，先备份 PostgreSQL，再运行迁移与 Preview slug 回填，重启 `cloudcrane-production` tmux 会话，检查 Web、Agent、Workspace Gateway、Preview Gateway，并验证 Nginx 配置。健康检查失败时会尝试重启上一版应用。数据库备份位于 `/var/backups/cloudcrane/postgres/`；应用回滚不会自动恢复数据库，Schema migration 必须保持应用版本兼容。

服务器当前存在未跟踪的 `docker/compose/docker-compose.server.yml`，自动脚本使用它定位 PostgreSQL 容器；不要在清理或重新 clone 服务器工作区时丢失该私有配置。数据库备份恢复流程尚未实测，首次启用后应补做恢复演练。

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
