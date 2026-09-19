# 模板发布检查表

## 发布前

- 确认当前 Website 和 `/workspace` 是本次发布来源。
- 执行 `git status --porcelain`，记录改动是否为用户预期。
- 读取 bootstrap、Managed Core marker、Pboot version、source commit 和 db schema version；缺失或互相矛盾时停止。
- 使用现有 Core Drift 机制检查 Managed Core。任何 Drift 都要先分类和确认，不能静默发布。
- 执行 `PRAGMA integrity_check;`，结果必须为 `ok`。
- 在 Preview 中检查桌面和移动宽度：首页、导航、主要栏目、详情页和静态资源。
- 检查 Console、Network 和明显 404；只看 HTTP 200 不足以通过验收。
- 发现疑似真实生产内容时，用 `question` 让用户选择直接发布或先改为示例内容；不自动删除或替换业务资料。

## 发布动作

- 只调用现有确定性 Website → Snapshot → Artifact → Template 能力。
- 不执行手工 ZIP，不生成临时迁移 SQL，不直接写 Template 数据库。
- 不携带旧 Core、授权、管理员账号、运行时、日志、会话或其他 Managed/ephemeral state。

## 发布后

- 确认 Template 记录存在且为 `published`。
- 核对 source Website、Artifact SHA-256/大小/类型、Snapshot schema、Pboot/Core/db schema metadata。
- 核对真实 Demo URL 和 Cover URL；没有 Demo 时明确说明在线 Preview 不可用。
- 确认 Template Catalog 可读取；允许时再用 Gallery/Preview 做一次可见性检查。
- 报告脱敏状态和计数，不输出密码、Token、Cookie、授权码、完整数据库或完整 Prompt。
