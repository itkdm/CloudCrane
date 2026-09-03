# CloudCrane（筑云鹤）工程协作规范

CloudCrane 是本仓库的正式项目名；Website Coding Agent、Website Agent 和 PbootCMS 是产品定位或技术概念，不因品牌统一而机械替换。

在实现、修改、重构、调试、审查、测试，或涉及数据库 schema、协议、Agent、Workspace、Runner、Gateway、Web UI 的工作前，必须完整阅读 `.agents/skills/cloudcrane-engineering/SKILL.md`。架构变更还必须阅读对应的 `docs/website-coding-agent-tech-01` 至 `tech-07` 文档。

遵守 Skill 中的边界、依赖方向、数据流、日志、测试和 E2E 规则。既有架构文档视为已确认基线；发现冲突时记录并请求确认，不隐藏或擅自重写。每次提交前完成适用的格式检查、lint、类型检查、测试和构建；Web UI 或用户流程验证必须使用 DEVTOOLS MCP。

## 协作与变更流程

- 开始任何实现、调试、测试或部署前，先检查 `git status --short --branch`、当前分支、`git log`、remote 和相关文件；需要基于远程最新代码时先执行 `git fetch origin`，默认在 `main` 上工作。
- 保留用户已有改动；不使用 `git reset --hard`、`git checkout --`、force push 或覆盖未知远程历史。切换分支前确认工作区干净，提交前检查 staged files 和 `git diff --check`。
- 先界定本轮任务和验收标准，只做最小必要改动。发现架构冲突、缺少凭据、远程状态不明或需要扩大范围时，停止并报告，不擅自替代设计。
- 搜索文件优先使用 `rg` / `rg --files`；文件修改使用 `apply_patch`。不要用脚本把秘密写入仓库，也不要把临时运行产物混入提交。

### 本地验收与远程服务硬规则

- CloudCrane 默认真实联调、DEVTOOLS 验收和网站列表检查必须使用 ECS 完整服务栈：先确认 SSH 隧道正常，再访问 `http://localhost:3000`。其中 Web、Agent、Workspace Gateway、Preview Gateway 和 PostgreSQL 均应对应远程服务。
- 不得把本地 `3001` 或其它端口的裸启动 Next Web 当作默认验收入口。特别是未加载远程 `DATABASE_URL`、Agent、Workspace Gateway 等环境变量时，禁止用它判断网站列表、数据库或部署是否正常；发现误启动时必须明确标记为本地备用进程，不得让用户继续使用该地址验收。
- 只有用户明确要求“本地 Web + ECS 后端”时，才允许启动本地 Web；启动前必须按 [本地远程开发恢复记录](docs/cloudcrane-local-remote-dev-recovery.md) 配置当前进程的远程数据库、Agent、Workspace Gateway、Preview 和必要 Token，并检查变量只存在不回显值。启动后仍需用 DEVTOOLS 验证实际请求链路。
- 每次启动、重启、调试或验收前，必须先检查 `3000`、SSH 转发端口和现有 Web 进程；不要为了显示 Website 列表切换到本机数据库。若 `localhost:3000` 与本地备用端口同时存在，默认只认 `3000` 的远程验收链路。
- 看到 `/api/websites` 加载失败时，先记录实际访问端口，再通过 DEVTOOLS 检查 `/api/websites` 的状态、Console/Network，并查看对应 Web 进程日志；不得直接修改列表逻辑或猜测数据库为空。`DATABASE_URL is required` 等配置错误应归类为本地启动环境错误。

## CloudCrane 架构工作方式

- `apps/` 是可部署进程和组合根；`packages/` 是协议、能力和适配器。Packages 不依赖 Apps，保持既有依赖方向，不为占位能力提前创建空层。
- Web、Agent Service、Workspace Gateway、Runner、Workspace Daemon、Preview Gateway 之间的边界以 Tech-01 至 Tech-07 为准。典型链路是 `Web → Agent Service / Workspace Gateway → Runner → Workspace Daemon → Workspace Container`。
- Website 的运行时文件、模板、数据库和只读 Reference 有明确所有权边界；不得把旧 PbootCMS Core、授权、管理员、运行时或私有 Reference 当作普通模板文件覆盖或提交。
- 本地 Workbench 的远程运行拓扑、SSH 隧道、ECS 健康检查和故障排查见 [本地远程开发恢复记录](docs/cloudcrane-local-remote-dev-recovery.md)；不要为了显示 Website 列表而新建或切换到空的本机数据库。

## 工具与真实验收

- UI、Chat、Preview、Workspace 生命周期、Agent Prompt、刷新/重连等用户流程，必须通过 DEVTOOLS MCP 连接真实服务验证。优先使用 `list_pages`、`navigate_page`、最新 `take_snapshot`、`list_network_requests` 和 `list_console_messages`；每次点击或填写前重新获取 snapshot，使用最新 uid。
- DEVTOOLS MCP 不可用时必须原样报告：`E2E blocked: DEVTOOLS MCP unavailable`。不能用 curl、Playwright 或普通浏览器替代并声称完成 CloudCrane UI E2E；curl/SSH 只用于辅助的服务器健康与只读状态检查。
- 真实验收要检查可见 DOM、用户反馈、Console、Network、刷新/重开后的持久化状态和关键错误路径。遇到授权失败、服务不可用或 Agent 未完成，不得人工绕过、自动开新窗口、自动刷新掩盖问题。
- 日志和最终报告不得包含密码、Cookie、Token、授权码、完整 Prompt、Session JSONL、文件内容或未过滤外部 stdout；报告使用状态、计数、哈希或脱敏路径。

## 质量与交付

- 适用时执行：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check`。区分本地环境阻塞、测试失败和远程 CI 尚未完成，不把未验证内容写成 PASS。
- 回归测试覆盖行为、错误路径、权限边界、协议和持久化；不要删除原有断言或用过度宽松的 mock 让测试“通过”。
- 提交信息使用清晰的 Conventional Commit；提交前汇报 Base SHA、改动文件、验证命令、未完成项和 Git 状态。除非用户明确要求，不自动 commit、push、部署或修改外部 DNS/Secret。

## Skill 路由

- 所有 CloudCrane 工程工作先完整阅读 `.agents/skills/cloudcrane-engineering/SKILL.md` 及其相关 references。
- 涉及架构、数据库 schema、协议、Agent、Workspace、Runner、Gateway 或 Web UI 时，按 Skill 路由阅读对应 Tech 文档；涉及真实 PbootCMS 模板迁移时才使用 `pboot-template-migration` Skill。
- Skill 与本文件或用户明确范围冲突时，记录冲突并以用户范围为准，不隐藏冲突。
