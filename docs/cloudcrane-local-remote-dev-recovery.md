# CloudCrane 本地远程开发恢复记录

本文记录本地 Workbench 与 ECS 远程运行环境的启动关系，以及网络中断后的恢复方法。文档不保存数据库密码、SSH 私钥、模型凭据、Preview Token 或 PbootCMS 授权码。

## 当前拓扑

本地只运行 Workbench，数据和后端服务使用 ECS：

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
2. 建立 SSH 隧道（端口可按本机占用情况调整）：

   ```powershell
   ssh -N `
     -L 15432:127.0.0.1:5432 `
     -L 14101:127.0.0.1:4101 `
     -L 14102:127.0.0.1:4102 `
     -L 14103:127.0.0.1:4103 `
     aliyun
   ```

3. 在启动当前 PowerShell 进程中设置远程数据库连接字符串。密码只从 ECS 私密环境读取，不要回显、写入仓库或提交：

   ```powershell
   $env:DATABASE_URL = 'postgresql://<remote-user>:<remote-password>@127.0.0.1:15432/<remote-database>'
   $env:WEB_ORIGIN = 'http://localhost:3000'
   $env:NEXT_PUBLIC_AGENT_SERVICE_URL = 'http://localhost:14101'
   $env:WORKSPACE_GATEWAY_ENDPOINT = 'http://127.0.0.1:14102'
   $env:PREVIEW_GATEWAY_ORIGIN_TEMPLATE = 'https://site-{websiteId}.preview.itkdm.com/'
   $env:PREVIEW_PUBLIC_PROTOCOL = 'https'
   $env:PREVIEW_COOKIE_SECURE = 'true'
   ```

4. 用当前项目的镜像依赖启动：

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

应看到本地 3000、14101、14102、14103 以及 SSH 隧道 15432。若 3000 未监听，Workbench 未启动；若 15432 未监听，远程数据库隧道未建立；若 Website 列表为空，先检查 `DATABASE_URL` 是否仍指向本机。

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
