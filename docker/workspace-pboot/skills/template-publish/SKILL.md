---
name: template-publish
description: Publish the current CloudCrane PbootCMS Website as an immutable, versioned template after preflight and Preview verification.
---

# 发布网站模板

当用户明确要求“把这个网站发布成模板”或同义请求时使用本 Skill。当前 Website 是唯一发布来源；不要访问其他 Website，也不要把这个流程变成手工打包流程。

先读取本 Skill 需要的参考资料：

- `references/publish-checklist.md`
- `references/template-metadata.md`

## 工作流程

1. 只读检查当前 Website：`git status --porcelain`、`/workspace/.cloudcrane/bootstrap.json`、Pboot 版本与受管 Core marker、Core Drift、SQLite `PRAGMA integrity_check;`。
2. 使用 Preview 检查桌面和移动宽度：首页、主要导航、栏目/详情页、静态资源、Console、Network 和明显 404。Preview 不可用或 Website 状态损坏时停止。
3. 审查内容是否明显包含真实业务资料。默认保留公司名、联系方式、文章、产品、图片、栏目、SEO、轮播和模型等 Site State；不要自动脱敏。若看起来是生产业务数据，使用 `question` 询问用户是直接发布还是先改成示例内容。用户选择修改时，先完成修改，再重新执行相关检查。
4. 从当前 Website 已知信息收集模板元数据。仅在无法合理确定必填值时使用 `question`；不要猜测或虚构 Demo URL。详细规则见 `template-metadata.md`。
5. 检查 Core Drift。无 Drift 才能继续；有 Drift 时列出证据，判断是否能迁移为 Site State 或必须先处理，并在用户确认前停止。不得把旧 Pboot Core、授权、管理员、运行时或系统状态发布进模板。
6. 调用当前系统提供的确定性 Website → Snapshot → immutable Artifact → Template 发布能力。不要自己执行 `zip`、手写 Snapshot、生成 SQL、直接插入 Template 表或绕过 SHA-256、版本元数据、Artifact 校验和 DB 完整性门禁。当前会话没有该确定性能力时必须 fail closed 并报告原因。
7. 发布后验证 Template 记录、`published` 状态、Artifact 元数据、`sourceWebsiteId`、Snapshot/版本信息、Demo/Cover 元数据和 Template Catalog 可见性。Published Template 不可原地修改；后续更新应修改源 Website 后重新发布新的 Snapshot。

## 必须停止

以下任一情况都停止，不绕过检查：DB integrity 失败、Pboot 或 schema 版本不可信、Core Drift 未处理、Preview/Website 明显损坏、来源 Website 无法确认、Snapshot Builder/Artifact 校验失败、确定性发布能力不可用，或发布后元数据无法核对。

本 Skill 不扩大权限：只能通过 Pi Agent 的现有 Remote Tools 操作当前 `/workspace`，不得访问其他 Website、Docker Socket、ECS 凭据、生产 Secret 或 PostgreSQL。
