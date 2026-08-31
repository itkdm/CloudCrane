# CloudCrane（筑云鹤）

CloudCrane（筑云鹤）是一个面向个人与企业用户的自助式 Website Coding Agent 平台：每个网站拥有长期存在的独立 Workspace，Agent 可以持续参与网站的开发、修改、验证、预览和维护。

项目目前处于早期开发阶段，核心架构已基本确定，正在进入 MVP 实现。当前产品定义与技术方案请参阅 [docs/](docs/) 中的架构基线文档。

## 本地开发要求

- Node.js 22+
- pnpm 10+
- Docker（用于本地 PostgreSQL）

```bash
pnpm install
pnpm dev
```

PostgreSQL 配置示例见 `.env.example`，数据库迁移可使用 `pnpm --filter @cloudcrane/db db:migrate`。

当前 Preview Bridge 只注入开发 Preview；严格的 Website CSP 可能阻止 Bridge 执行，届时 Preview Observation 会报告不可用。CSP 策略后续单独处理。
