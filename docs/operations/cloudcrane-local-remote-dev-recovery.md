# CloudCrane 远程开发与验收连接

本文说明本机如何通过 SSH 隧道访问远程 CloudCrane 完整服务，以及用户明确要求时如何运行本机 Web。默认不在本机启动 Docker、PostgreSQL 或整套 CloudCrane 服务。

## 远程主机

本机 SSH 配置中的主机别名为 `xunmao-sg219`：

```powershell
ssh xunmao-sg219
```

运维记录中的公网地址为 `186.244.238.219`，Guest OS 报告 KVM；云销售商和控制面未核实。地址、SSH Host Key、服务和 DNS 会变化，执行变更前从 SSH 配置及线上状态重新核对。不要把当前主机称作已确认的 Alibaba ECS。

## 私密配置

本机重建恢复配置位于项目根目录 `.env.private.local`，服务器对应文件为 `/opt/cloudcrane/.env.private.local`。文件受 `.gitignore` 保护，不得提交或回显：

```powershell
scp .env.private.local xunmao-sg219:/opt/cloudcrane/.env.private.local
```

服务器启动脚本还会读取 `/opt/cloudcrane/.env.server.local`。复制前确认目标文件和 SSH 主机正确；聊天、日志、截图和文档不记录 API Key、Token、数据库密码或完整环境变量。

## 默认流程：浏览器连接远程完整服务栈

真实联调时，Web、Agent、Workspace Gateway、Preview Gateway、Runner 和 PostgreSQL 均使用远程服务；本机只提供浏览器和 SSH 隧道：

```text
浏览器 → http://localhost:3000
             ↓ SSH 隧道
远程 Web :3000
远程 Agent :4101
远程 Workspace Gateway :4102
远程 Preview Gateway :4103
远程 PostgreSQL :5432（仅数据库排查时另建隧道）
```

启动前检查本机端口是否已被其他进程占用：

```powershell
Get-NetTCPConnection -State Listen
```

建立 Web/Agent/Gateway 隧道：

```powershell
ssh -N `
  -L 3000:127.0.0.1:3000 `
  -L 4101:127.0.0.1:4101 `
  -L 4102:127.0.0.1:4102 `
  -L 4103:127.0.0.1:4103 `
  xunmao-sg219
```

只有明确需要只读数据库诊断时，额外建立 `15432:127.0.0.1:5432` 隧道。默认远程 Web 流程不要求本机设置 `DATABASE_URL`，也不应为了显示 Website 列表切换到空的本机数据库。

生产入口的用户流程验收应直接打开 `https://app.itkdm.com`；本地 SSH 隧道不能替代公开 Nginx、Cloudflare、正式域名 Cookie 和公网 Preview/Production 路由检查。

## 备用流程：本机 Web + 远程后端

仅当用户明确要求检查尚未提交的本机 Web 改动时，才启动备用流程。使用本机 `3001`，后端和数据仍指向远程服务：

```text
本机 Web :3001
  ├─ SSH 隧道 → 远程 PostgreSQL :5432
  ├─ SSH 隧道 → 远程 Agent :4101
  ├─ SSH 隧道 → 远程 Workspace Gateway :4102
  └─ Preview → https://{previewSlug}.preview.itkdm.com/
```

启动前核对当前进程的环境变量是否存在，不打印变量值。`DATABASE_URL` 必须通过 SSH 隧道访问远程 PostgreSQL；Agent 和 Workspace Gateway 的 endpoint/token 必须指向远程服务。缺少远程变量时，本机可能回退到 `.env` 并显示空网站列表，这不代表远程数据库为空。

本机启动命令：

```powershell
pnpm --filter @cloudcrane/web dev -- --port 3001
```

Preview 继续使用 canonical Preview 域名。`.env.example` 中的 `{previewSlug}.localhost` 只用于完整本机 Preview Gateway，不可用于本机 Web + 远程 Gateway 模式。

## 常见现象

- `localhost:3000` 拒绝连接：远程 Web 隧道未建立或端口被占用；先核对监听端口和 SSH 连接。
- `/api/websites` 加载失败：先记录浏览器实际访问端口，再用 DEVTOOLS 查看请求状态和 Web 进程日志；不要推断数据库为空。
- `DATABASE_URL is required`：本地启动/构建环境缺配置，不表示远程数据库不可用，也不表示已经访问数据库。纯 Build 的安全占位方式见[工程生命周期说明](cloudcrane-development-lifecycle.md#build-配置经验)。
- Preview 返回 `401 preview authorization is required`：无有效 Preview 授权会话时可能是预期响应，继续检查 Cookie/短期凭证，不要关闭授权来绕过。
- Preview URL 长时间未刷新：短期 URL 可能过期。回到 Workbench 重新获取有效 URL 后再检查，不要用新窗口/自动刷新掩盖链路错误。

## 远程健康检查

SSH 登录后可检查内部服务健康状态：

```bash
curl -fsS http://127.0.0.1:4101/health
curl -fsS http://127.0.0.1:4102/health
curl -fsS http://127.0.0.1:4103/health
```

检查失败时先看对应服务日志和端口，再判断是否需要恢复。恢复平台服务使用[生产部署手册](cloudcrane-production-deploy.md)中的脚本；不要并发执行人工重启和 GitHub Actions 自动部署。

## 安全边界

- 不把远程数据库密码、API Key、Cookie、Token 或授权码复制到 `.env.example`、Git、日志或聊天。
- 不删除或重建远程数据库来处理本机空列表。
- 不用本机空库判断远程状态，也不把本机 `3001` 的裸启动误报为生产验收。
- 不修改 `itkdm.com` apex 或其他网站的 DNS 记录；CloudCrane Preview 和 Website Production 分别使用 `*.preview.itkdm.com` 与 `*.site.itkdm.com`。
