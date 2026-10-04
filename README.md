# CloudCrane（筑云鹤）

CloudCrane（筑云鹤）是一个面向个人与企业用户的自助式 Website Coding Agent 平台：每个网站拥有长期存在的独立 Workspace，Agent 可以持续参与网站的开发、修改、验证、预览和维护。

项目已实现 Website Workspace、Agent 编码与 Preview、Production 发布和一组 PbootCMS 内容管理操作，并在受控测试站完成了多条真实用户流程验收。目前仍处于开发中的受控测试阶段；本说明不代表多节点扩展、完整灾备或商业计费已交付。当前实现、验证证据与已知边界见[工程生命周期说明](docs/operations/cloudcrane-development-lifecycle.md)，方案文档与运维手册入口见[文档索引](docs/README.md)。

Preview 子域、TLS、Nginx 与远程验收环境操作请参阅 [CloudCrane Preview 运维手册](docs/operations/cloudcrane-operations-preview.md)。

日常修改、提交、CI/CD、测试和部署流程见[工程生命周期说明](docs/operations/cloudcrane-development-lifecycle.md)。

## 本地代码开发与可选全栈环境

通常在本机编辑代码并运行适用的质量检查；真实服务联调和用户流程验收使用远程完整服务栈。下面的 Docker/PostgreSQL 步骤只用于明确选择本机全栈开发时，不是发布或默认验收前置条件，也不要求为此在本地补齐服务器环境。

- Node.js 22+
- pnpm 10+
- Docker（用于本地 PostgreSQL）

```bash
pnpm install --frozen-lockfile
cp .env.example .env
docker compose -f docker/compose/docker-compose.yml up -d postgres
pnpm --filter @cloudcrane/db db:migrate
pnpm dev
```

Windows PowerShell 下用 `Copy-Item .env.example .env` 代替 `cp`。如果本地没有配置 Resend 邮件服务，在 `.env` 中将 `AUTH_REQUIRE_EMAIL_VERIFICATION` 和 `NEXT_PUBLIC_AUTH_REQUIRE_EMAIL_VERIFICATION` 都设为 `false`，否则注册验证邮件无法投递；本地关闭验证仅限开发环境，生产配置按认证上线文档启用邮件验证。

以上是本机开发环境，不是默认的真实服务验收环境。`.env` 使用本地开发占位配置并被 Git 忽略；真实用户流程验收仍按根目录 `AGENTS.md` 连接远程完整服务栈。停止开发服务后可执行 `docker compose -f docker/compose/docker-compose.yml down`；不要附加 `-v`，以保留本地 PostgreSQL 数据卷。

当前 Preview Bridge 只注入开发 Preview；严格的 Website CSP 可能阻止 Bridge 执行，届时 Preview Observation 会报告不可用。CSP 策略后续单独处理。
