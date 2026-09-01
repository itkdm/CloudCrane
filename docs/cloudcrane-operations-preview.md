# CloudCrane（筑云鹤）Preview 运维手册

本文记录当前 CloudCrane MVP 的公网 Preview 运维配置。它只适用于 Preview，不代表 Production、模板导入、发布或域名绑定已经实现。

## 1. 域名边界

主域名 `itkdm.com` 已被其他网站使用，CloudCrane 不接管、修改或重定向该 apex 域名。

当前 Preview 统一使用：

```text
https://site-{websiteId}.preview.itkdm.com/
```

其中 `{websiteId}` 是完整 UUID。所有 Website 共用一个 wildcard DNS 记录，不为每个 Website 单独创建 DNS 记录。

## 2. Cloudflare DNS

在 Cloudflare 的 `itkdm.com` Zone 中添加：

| 类型 | 名称 | 内容 | TTL | 代理 |
| --- | --- | --- | --- | --- |
| A | `*.preview` | 当前 Preview Gateway ECS 公网 IPv4 | Auto | DNS only（灰云） |

当前 ECS 公网 IPv4 为 `39.97.34.189`；迁移 ECS 后必须同步更新该记录，并在 ECS 上重新检查解析结果。

不要修改以下记录：

- `@` / `itkdm.com`
- 现有其他网站的 `A`、`CNAME`、`NS` 记录

检查：

```bash
dig +short A site-<websiteId>.preview.itkdm.com
```

应返回 Preview Gateway 所在 ECS 的公网 IP。Wildcard 记录只在没有更具体的同名记录时生效；Cloudflare 的 DNS 页面中 wildcard 名称使用 `*` 前缀。[Cloudflare wildcard DNS 文档](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/)

## 3. TLS 证书

Preview 使用：

```text
*.preview.itkdm.com
```

当前 ECS 证书路径：

```text
/etc/letsencrypt/live/preview.itkdm.com/fullchain.pem
/etc/letsencrypt/live/preview.itkdm.com/privkey.pem
```

Wildcard 证书必须使用 DNS-01 验证。手动申请时：

```bash
sudo certbot certonly --manual --preferred-challenges dns \
  --server https://acme-v02.api.letsencrypt.org/directory \
  -d '*.preview.itkdm.com'
```

Certbot 会提示添加类似下面的 TXT 记录：

```text
名称：_acme-challenge.preview
类型：TXT
内容：Certbot 当前提示的验证值
```

必须等权威 DNS 能查到 TXT 后，再回到 Certbot 按 Enter 继续。TXT 值不要写进 Git、日志或本手册。DNS-01 是申请 wildcard 证书的正确验证方式。[Certbot DNS challenge 文档](https://eff-certbot.readthedocs.io/en/stable/using.html)

当前证书是通过 `--manual` 方式申请的，不会自动续期。后续运维应改为 Cloudflare DNS API 的最小权限 token 配合 Certbot DNS plugin 或 auth hook；token 只能保存在 ECS 私密环境或 Secret 管理系统，不得提交仓库。

## 4. Nginx

仓库模板：

```text
deploy/nginx/cloudcrane-preview.conf
```

ECS 安装位置：

```text
/etc/nginx/sites-available/cloudcrane-preview.conf
/etc/nginx/sites-enabled/cloudcrane-preview.conf
```

路由关系：

```text
HTTPS 443 / *.preview.itkdm.com
        ↓
127.0.0.1:4103 Preview Gateway
```

Nginx 必须保留以下请求头：

```text
Host: $host
X-Forwarded-Host: $host
X-Forwarded-Proto: https
```

Preview Gateway 只绑定 `127.0.0.1:4103`，不应把 4103 直接暴露到公网。修改后检查：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

不要修改现有其他站点的 server block；如果 `nginx -t` 失败，不要 reload。

## 5. CloudCrane 私密环境变量

ECS 的 `/opt/cloudcrane/.env.server.local` 应包含以下非 Secret 配置：

```dotenv
PREVIEW_GATEWAY_ORIGIN_TEMPLATE=https://site-{websiteId}.preview.itkdm.com/
PREVIEW_HOST_SUFFIXES=preview.itkdm.com,localhost
PREVIEW_PUBLIC_PROTOCOL=https
PREVIEW_COOKIE_SECURE=true
```

以下内容必须留在私密环境，不得放进 Git 或文档：

- `PREVIEW_SIGNING_SECRET`
- `WORKSPACE_GATEWAY_CLIENT_TOKEN`
- 数据库密码
- Agent 模型凭据
- Cloudflare API token
- PbootCMS 官方授权码

其中 `PREVIEW_COOKIE_SECURE=true` 会让 Preview 授权 Cookie 使用 `SameSite=None; Secure; HttpOnly`，用于 HTTPS iframe 场景。

## 6. ECS 服务重启

当前验收服务由 `scripts/server-acceptance-start.sh` 以 tmux 管理。部署新代码或修改私密环境后，在 `/opt/cloudcrane` 执行：

```bash
tmux ls
tmux attach -t cloudcrane-acceptance
```

停止旧服务后重新启动：

```bash
tmux kill-session -t cloudcrane-acceptance
./scripts/server-acceptance-start.sh
```

重启后检查：

```bash
curl -fsS http://127.0.0.1:4103/health
ss -ltnp | grep 4103
```

预期 Preview Gateway 只监听 `127.0.0.1:4103`。

## 7. PbootCMS 授权运维

新 Website 初始化完成后状态为：

```text
provisioning → initializing → authorization_required → ready
```

授权必须来自 PbootCMS 官方流程。CloudCrane 不修改 PbootCMS Core，不绕过授权校验，也不把授权码放进 URL。

用户在 Web UI 输入官方授权码后，服务端通过既有链路调用 Workspace：

```text
Web → Workspace Gateway → Runner → Workspace Daemon → Workspace Container
```

授权 Helper 在容器内事务性更新 `ay_config` 的 `sn`、`sn_user`、`licensecode`，并清理 `/workspace/runtime/config` 缓存。V1 的 `sn_user` 为空；`licensecode` 按固定 PbootCMS 版本官方后台保存逻辑生成。授权码从环境变量传给 Helper，不作为命令参数。

授权写入成功后，还必须使用 canonical Preview Host 做真实 HTTP 验证，成功后才将 Website 标为 `ready`。

禁止：

- 在日志、浏览器 localStorage、Session、Agent Prompt、Tool Result 中记录完整授权码
- 将授权码写入 `.env.example`、Git 或 Docker Image
- 因授权失败修改 `core/`、`Check.php` 或其他 PbootCMS 授权代码

## 8. Preview 验收清单

使用真实 ECS、真实 Workspace 和真实 Preview：

1. 首次打开 `https://site-{websiteId}.preview.itkdm.com/`，不人工刷新、不打开新窗口。
2. 确认 TLS 有效、iframe 返回 200、Preview Bridge READY。
3. 在 DevTools Network 中确认 token 只用于首次授权，之后由 HttpOnly Cookie 承载，URL 不保留 token。
4. 无授权时应看到 PbootCMS 官方授权提示，Website 状态为 `authorization_required`。
5. 输入合法官方授权码后，确认实际首页可以访问，状态变为 `ready`。
6. 用 Agent 执行只读首页观察，再执行一次小范围文字修改，确认 `edit → preview_refresh → observation` 完成。
7. 检查 Console 无错误、Session title 正常、Composer 始终可见。

故障排查顺序：

```text
DNS → TLS → Nginx 443 → Preview Gateway health
→ Preview Cookie → PbootCMS authorization → Bridge → Agent observation
```

不要用自动刷新、自动打开新窗口或去掉 Preview Auth 来掩盖问题。

## 9. Git 运维约束

- `.env.server.local`、证书私钥、Cloudflare token、PbootCMS 授权码不提交。
- Nginx 模板和本运维手册可以提交。
- 生产/Preview 配置修改后先执行 `git diff --check` 和适用的质量检查。
- 未经确认不要 force push、覆盖远端历史或修改 apex 域名。
