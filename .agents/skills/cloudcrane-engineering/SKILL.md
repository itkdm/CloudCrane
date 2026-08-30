---
name: cloudcrane-engineering
description: Mandatory engineering rules for implementing, refactoring, reviewing, debugging, or testing CloudCrane. Covers architecture, dependency direction, data flow, logging, testing, and DEVTOOLS MCP end-to-end verification.
---

# CloudCrane Engineering

CloudCrane（筑云鹤）当前以 `docs/website-coding-agent-tech-01` 至 `tech-07` 为架构基线。开始工作前先确认任务边界，再按引用路由阅读所需资料；不要把规划、占位包或脚手架误称为已实现能力。

## Mandatory principles

- 采用“可部署 Apps + 能力 Packages + 轻量 Ports/Adapters”。Apps 是进程与组合根；Packages 承载可复用能力、协议和适配器；Packages 不依赖 Apps。
- 遵守 `references/architecture.md` 的依赖方向、数据流和边界。架构变化必须先阅读对应 Tech 文档；冻结内容的冲突必须显式记录并请求确认。
- 服务边界使用结构化日志；不得用 `console.log`，不得记录密钥、Cookie、认证信息、完整大 Prompt、文件内容或未过滤外部 stdout。
- 测试优先覆盖行为、协议、边界错误和回归；禁止用浅层导出测试制造虚假覆盖率。
- Web UI、Chat、Preview、刷新/重连、Workspace 创建和 Agent 交互的开发验收必须使用真实开发服务与 DEVTOOLS MCP。DEVTOOLS MCP 不可用时必须明确报告 `E2E blocked: DEVTOOLS MCP unavailable`，不得用其他浏览器冒充该验收。

## Reference routing

- 分层、依赖、数据流、包职责、运行时边界：`references/architecture.md`
- Pino、字段、级别、错误和敏感信息：`references/logging.md`
- 测试金字塔、数据库/协议/远程操作回归和提交前检查：`references/testing.md`
- UI/E2E、Console、Network、截图、刷新与重连：`references/e2e-devtools-mcp.md`

## Delivery checklist

1. 阅读本 Skill 和任务相关引用；涉及架构时阅读对应 Tech 文档。
2. 先定义边界和真实验收标准，再实现最小必要改动；不提前制造空的 domain/controller/service/repository/dao 层。
3. 检查依赖方向、日志上下文、错误路径、权限边界和持久化边界。
4. 运行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；未实现的占位包可使用 `passWithNoTests`，但不能跳过真实逻辑的测试。
5. 汇报变更、验证结果、未完成项和阻塞项；不自动扩大范围。
