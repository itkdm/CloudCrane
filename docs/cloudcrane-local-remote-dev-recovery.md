# CloudCrane 本地远程开发恢复记录

本文记录 CloudCrane 默认验收拓扑与备用本地开发拓扑的启动关系，以及网络中断后的恢复方法。默认验收使用 ECS 上的完整服务栈，浏览器通过 SSH 隧道访问；文档不保存数据库密码、SSH 私钥、模型凭据、Preview Token 或 PbootCMS 授权码。

## 当前拓扑

## 默认流程：ECS Web + ECS 后端

后续真实联调和 DEVTOOLS 验收默认使用这一流程。Web、Agent、Workspace、Preview 和 PostgreSQL
均运行在 ECS，浏览器只访问本机 SSH 转发端口：

```text
浏览器 → http://localhost:3000
             ↓ SSH 隧道
ECS Web :3000
ECS Agent :4101
ECS Workspace Gateway :4102
ECS Preview Gateway :4103
ECS PostgreSQL :5432
```

这样浏览器侧的 Agent URL 与 ECS Web 的正式验收配置保持一致，避免把本地 Web 配置、本地数据库
和远程服务混用。默认流程不启动本地 Web，也不要求本机存在远程数据库连接字符串。

## 备用流程：本地 Web + ECS 后端

只有需要实时查看本地未提交 Web 改动时才使用此流程。此时本地运行 Workbench，数据和后端服务
仍使用 ECS：

```text
浏览器 → http://localhost:3000
             ├─ SSH 隧道 → ECS PostgreSQL 5432
             ├─ SSH 隧道 → ECS Agent Service 4101
             ├─ SSH 隧道 → ECS Workspace Gateway 4102
             └─ SSH 隧道 → ECS Preview Gateway 4103
```

ECS 内部服务只监听回环地址；远程 PostgreSQL 的真实连接信息只保存在 ECS 私密环境中，不复制到 Git 或普通日志。

## 网络中断后的现象

- 本地开发进程会退出，`localhost:3000` 返回 `ERR_CONNECTION_REFUSED`。
- 本地若没有正确的远程环境变量，服务会退回读取本机配置，网站列表可能显示为空。
- 本机 PostgreSQL 即使存在，也不是 CloudCrane 的远程 Website 数据源；不要用空的本机库替代 ECS 数据库。
- 依赖安装中断可能留下指向临时目录的 pnpm junction。优先使用 `pnpm install --frozen-lockfile` 从镜像恢复，并只处理确认失效的链接。

## 恢复步骤

1. 确认当前分支为 `main`，工作区没有无关改动。
2. 默认验收建立完整 SSH 隧道（端口可按本机占用情况调整）：

   ```powershell
   ssh -N `
     -L 15432:127.0.0.1:5432 `
     -L 4101:127.0.0.1:4101 `
     -L 4102:127.0.0.1:4102 `
     -L 4103:127.0.0.1:4103 `
     aliyun
   ```

3. 在启动当前 PowerShell 进程中设置远程数据库连接字符串。密码只从 ECS 私密环境读取，不要回显、写入仓库或提交：

   ```powershell
   $env:DATABASE_URL = 'postgresql://<remote-user>:<remote-password>@127.0.0.1:15432/<remote-database>'
   $env:WEB_ORIGIN = 'http://localhost:3000'
   # 默认 ECS Web 流程不需要在本地设置这些变量。
   # 仅使用备用“本地 Web + ECS 后端”流程时设置：
   $env:NEXT_PUBLIC_AGENT_SERVICE_URL = 'http://localhost:14101'
   $env:WORKSPACE_GATEWAY_ENDPOINT = 'http://127.0.0.1:14102'
   $env:PREVIEW_GATEWAY_ORIGIN_TEMPLATE = 'https://site-{websiteId}.preview.itkdm.com/'
   $env:PREVIEW_PUBLIC_PROTOCOL = 'https'
   $env:PREVIEW_COOKIE_SECURE = 'true'
   ```

### 本地 Web 与正式 Preview 地址的边界

`localhost:3000` 只是本地 Web 的访问地址，不代表 Website Preview 也应该使用
`localhost`。当本地 Web 通过 SSH 隧道连接 ECS 的数据库、Agent Service、Workspace
Gateway 和 Preview Gateway 时，Preview 仍应使用正式的 canonical host：

```powershell
$env:PREVIEW_GATEWAY_ORIGIN_TEMPLATE = 'https://site-{websiteId}.preview.itkdm.com/'
$env:PREVIEW_HOST_SUFFIXES = 'preview.itkdm.com,localhost'
$env:PREVIEW_PUBLIC_PROTOCOL = 'https'
$env:PREVIEW_COOKIE_SECURE = 'true'
```

`.env.example` 中的 `site-{websiteId}.localhost` 仅用于完全本地的 Preview Gateway
开发场景。它不能作为“本地 Web + ECS 远程 Preview”模式的配置，否则设置页会显示
错误的 localhost 预览地址，并可能与正式 DNS、TLS 及授权 Cookie 行为不一致。

Preview 地址相关环境变量在 Web 进程启动时读取。修改后必须重启 Web，再刷新页面并
在 Website Settings 中确认地址；不要只刷新浏览器页面。

### 远程服务凭据的最小检查

本地 Web 使用 ECS 的 Workspace Gateway 时，除了将 `DATABASE_URL` 指向 SSH 隧道端口，
还必须向当前进程提供与 ECS 私密环境一致的 `WORKSPACE_GATEWAY_CLIENT_TOKEN`。
缺少该 token 时，ECS 健康检查仍可能全部正常，但创建 Website 会在 Web → Workspace
Gateway 鉴权处失败并表现为 `502` 或 `provisioning_failed`。排查时只检查变量是否存在，
不要回显 token、数据库密码或完整连接字符串。

### Preview 直连返回 401 的含义

对 canonical Preview host 直接发起请求时，如果尚未完成 Preview 授权会话，返回
`401 Unauthorized` 可以是预期结果。这说明请求已到达 Preview Gateway；应继续检查
Preview Cookie / PbootCMS 授权流程，不要因此把地址改回 localhost、绕过授权或重建数据库。

Preview URL 中的访问凭证是短期凭证，默认有效期为 600 秒。Workbench 如果长时间保持
打开，前端可能仍持有已过期的 Preview URL：此时 Agent Service 的 `/preview` 请求仍会
返回 200，但 iframe 请求 canonical host 会返回 `401` 和 `preview authorization is
required`。先刷新 Workbench 获取新的 Preview URL，再复测；若新 URL 经 302 后返回 200
且 `__cloudcrane/preview-bridge.js` 也返回 200，说明域名、TLS、Gateway 和工作区链路
正常，问题是旧凭证过期而不是 DNS 或网站内容故障。

4. 默认验收直接使用 ECS acceptance tmux 服务，不启动本地 Web。
   只有备用本地 Web 流程才用当前项目的镜像依赖启动：

   ```powershell
   pnpm exec turbo dev --env-mode=loose
   ```

5. 验证顺序：

   ```powershell
   pnpm --filter @cloudcrane/db db:verify
   ```

   然后打开 [http://localhost:3000/app/websites](http://localhost:3000/app/websites)，确认原 Website 列表出现。Workbench、Chat、Workspace 和 Preview 的用户流程继续使用 DEVTOOLS MCP 验证。

## 排查清单

```powershell
Get-NetTCPConnection -State Listen
```

默认 ECS Web 流程应看到本地 3000、4101、4102、4103；如果还需要执行数据库验证，额外建立
15432 隧道。若 3000 未监听，SSH 到 ECS Web 的转发未建立；若 4101 未监听，浏览器无法连接
Agent Service；若 Website 列表为空，先检查 ECS Web 的私密环境和数据库连接。

备用本地 Web 流程才使用 14101、14102、14103 和 15432，并要求本地 Web 进程及远程数据库
环境变量均正确设置。

ECS 侧应检查：

```bash
curl -fsS http://127.0.0.1:4101/health
curl -fsS http://127.0.0.1:4102/health
curl -fsS http://127.0.0.1:4103/health
```

如果 ECS 健康检查正常而本地打不开，问题通常是本地进程或 SSH 隧道；如果 Preview 返回 `preview authorization is required`，这是 Preview Cookie/授权会话问题，不应通过绕过授权解决。

## 重要边界

- 不把 ECS 数据库密码复制进 `.env.example`、Git、日志或聊天记录。
- 不删除或重建 ECS 数据库来解决本地空列表。
- 不把本机空数据库当作远程数据恢复方案。
- 不修改 `itkdm.com` apex 域名配置；Preview 使用 `*.preview.itkdm.com`。
