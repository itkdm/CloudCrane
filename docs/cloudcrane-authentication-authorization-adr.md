# CloudCrane 认证与授权架构决策

状态：已实现第一版；新加坡服务器已完成迁移、部署和核心真实 E2E 验收。邮件 Provider、Google OAuth 仍需补充生产凭据后验收。

## 决策

- 认证使用固定版本 Better Auth `1.7.5`，数据库使用现有 PostgreSQL/Drizzle。
- 邮箱密码、邮箱验证、密码重置和 Google OAuth 由 Better Auth 统一处理。
- Better Auth 核心表位于平台数据库；Web 通过 `/api/auth/[...all]` 暴露同源 API。
- `user.role=admin` 是平台管理员身份；管理员可查看全部 Website，但仍需经过统一授权函数。
- Website 的业务授权根是 `website.owner_id`。普通用户只能访问自己拥有的 Website；客户端提交的 ownerId 永远不可信。
- Agent Service REST 和 WebSocket 都校验 Better Auth session，并再次校验 Website 所有权。内部 Workspace Gateway token 与用户身份完全分离。
- Preview token 仍是短期、限定 Website 的运行时访问凭证，不能代替平台用户 session。

## 数据迁移

`0004_auth_and_website_ownership.sql` 创建 Better Auth 表并增加 `website.owner_id` 索引。旧 Website 暂时保持 `NULL`，普通用户不能访问；迁移前必须由管理员明确归属，禁止自动把旧数据分配给第一个注册用户。

## 安全边界

页面保护只负责用户体验，API、Agent REST 和 Agent WS 是最终安全边界。Cookie 写入的变更接口校验 Origin；Agent Service 只允许配置的 Web Origin。跨端口浏览器调用必须携带 credentials，WebSocket 在升级阶段校验 Cookie、Origin 和后续 command 的 Website ownership。

当前服务器通过 SSH 隧道以 `http://localhost:3000` 验收，Agent Service 的 `WEB_ORIGIN` 和 Web 的 `NEXT_PUBLIC_AGENT_SERVICE_URL` 必须与浏览器实际 Origin/主机命名保持一致；`127.0.0.1:3000` 与 `localhost:3000` 不应混用，否则 Cookie 或浏览器 CORS 会阻止 Agent 请求。正式域名部署时，应将 Web 和 Agent 的允许来源同步切换为正式 Web Origin。

## 必需私密配置

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
AUTH_EMAIL_FROM
RESEND_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

真实值只能放在本地 `.env.private.local` 和服务器 `/opt/cloudcrane/.env.private.local`，不能提交 Git。未配置 Google 时邮箱密码登录仍可用；未配置邮件服务时，生产环境不得开启邮箱验证流程。

## 验收要求

服务器部署后必须使用 DEVTOOLS MCP 验证：匿名用户被重定向、注册/登录、邮箱验证入口、密码重置入口、Website 创建归属、用户间 403/404、管理员覆盖、Agent REST/WS、退出登录和刷新持久化。不能以 curl 或本地裸启动 Web 代替 UI E2E。

本轮服务器已通过 DEVTOOLS MCP 验证匿名重定向、Email 登录、错误密码 `401`、Website 列表 `200`、退出登录、Agent REST 的匿名 `401`、已登录跨端口凭证传递、WebSocket 握手和非法 Website attach 拒绝。由于服务器没有 Resend/Google 凭据，真实邮箱验证、密码重置邮件和 Google OAuth 回调仍属于部署配置后的待验收项。
