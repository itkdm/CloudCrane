# Testing Reference

采用测试金字塔：纯逻辑 unit、跨边界 contract、真实依赖 integration、真实开发服务 E2E。测试行为和失败路径，不为导出符号本身写浅层测试。

- Bug 修复先写能复现的回归测试。
- 外部边界默认 mock；协议使用 schema/contract 测试；迁移和 schema 验证使用真实 PostgreSQL。
- 远程操作至少覆盖成功、错误、超时、取消、冲突和幂等/重试语义；安全边界要有回归测试。
- 尚无真实逻辑的占位包可 `passWithNoTests`，一旦有行为就必须补对应测试。
- 每次提交前运行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，并确认 lint 实际扫描 `.ts/.tsx`。
- UI、Chat、Preview、Workspace 生命周期和 Agent 交互按 `e2e-devtools-mcp.md` 验收。
