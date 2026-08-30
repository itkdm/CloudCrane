# CloudCrane（筑云鹤）工程协作规范

CloudCrane 是本仓库的正式项目名；Website Coding Agent、Website Agent 和 PbootCMS 是产品定位或技术概念，不因品牌统一而机械替换。

在实现、修改、重构、调试、审查、测试，或涉及数据库 schema、协议、Agent、Workspace、Runner、Gateway、Web UI 的工作前，必须完整阅读 `.agents/skills/cloudcrane-engineering/SKILL.md`。架构变更还必须阅读对应的 `docs/website-coding-agent-tech-01` 至 `tech-07` 文档。

遵守 Skill 中的边界、依赖方向、数据流、日志、测试和 E2E 规则。既有架构文档视为已确认基线；发现冲突时记录并请求确认，不隐藏或擅自重写。每次提交前完成适用的格式检查、lint、类型检查、测试和构建；Web UI 或用户流程验证必须使用 DEVTOOLS MCP。
