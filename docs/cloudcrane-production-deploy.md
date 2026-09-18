# CloudCrane 生产入口部署

当前生产入口使用新加坡服务器 `xunmao-sg219`（公网 IPv4：`186.244.238.219`）。Cloudflare 的 `itkdm.com` Zone 保留现有 apex 和其他站点记录，只新增/更新 CloudCrane 专用记录：

| 记录 | 类型 | 内容 | 代理 |
| --- | --- | --- | --- |
| `app.itkdm.com` | A | `186.244.238.219` | 已代理 |
| `*.preview.itkdm.com` | A | `186.244.238.219` | 仅 DNS |

Web 主站使用 `https://app.itkdm.com`；Preview 使用 `https://site-{websiteId}.preview.itkdm.com/`。apex `itkdm.com`、`www` 以及已有邮件/验证记录不属于 CloudCrane，禁止改写。

## 服务器入口

Nginx 配置模板：

```text
deploy/nginx/cloudcrane-production.conf
```

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

部署配置中：

```dotenv
WEB_ORIGIN=https://app.itkdm.com
BETTER_AUTH_URL=https://app.itkdm.com
NEXT_PUBLIC_AGENT_SERVICE_URL=/agent
PREVIEW_GATEWAY_ORIGIN_TEMPLATE=https://site-{websiteId}.preview.itkdm.com/
PREVIEW_HOST_SUFFIXES=preview.itkdm.com
PREVIEW_PUBLIC_PROTOCOL=https
PREVIEW_COOKIE_SECURE=true
```

## 正式邮件

Resend 已验证 `itkdm.com`，服务器与本地私密配置使用：

```dotenv
AUTH_EMAIL_FROM="CloudCrane <auth@itkdm.com>"
AUTH_REQUIRE_EMAIL_VERIFICATION=true
```

Cloudflare 中保留 Resend 要求的 DNS-only 记录：`resend._domainkey` TXT、`rsend` CNAME 和 `send` CNAME。不要开启这些记录的 Cloudflare 代理；API Key 只能放在 `.env.private.local`。

## 发布与检查

### 线上发布原则

生产验收必须直接访问 `https://app.itkdm.com`，不要把仅用于 ECS 内部联调的
`http://localhost:3000` 当作线上结果。`localhost:3000` 只适用于 SSH 隧道下的
远程服务验收；如果使用它验收，必须显式覆盖 `NEXT_PUBLIC_AGENT_SERVICE_URL` 为
`http://localhost:4101`，因为生产构建中的 `/agent` 依赖 Nginx 的路径反代。

线上切换时只保留一套服务：先停止旧的 tmux 服务，再从当前提交构建并启动新服务，
最后通过 Nginx 入口检查 Web、Agent、Preview 和 WebSocket。不要同时启动旧目录和新目录
的同端口服务，也不要用相对路径启动脚本绕过正式反向代理。

本次线上故障排查得到的关键结论：浏览器请求 `/agent/v1/...` 返回 307 后变成
`/<locale>/agent/v1/...`，说明请求落入 Next 国际化中间件而不是 Nginx 的 `/agent/`
反代。该问题应修正部署入口或 `NEXT_PUBLIC_AGENT_SERVICE_URL`，不能修改会话业务路由
来掩盖反代配置错误。

```bash
cd /opt/cloudcrane
git fetch origin main
git reset --ff-only origin/main
set -a
. ./.env.server.local
. ./.env.private.local
set +a
pnpm build
tmux kill-session -t cloudcrane-acceptance || true
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
