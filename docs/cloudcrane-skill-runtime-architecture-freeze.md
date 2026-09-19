# CloudCrane Skill Runtime Architecture Freeze

## 结论

CloudCrane 直接复用 `@earendil-works/pi-coding-agent@0.84.4` 的原生 Skills：`DefaultResourceLoader`、`additionalSkillPaths`、Pi 的 `SKILL.md` frontmatter parser、`formatSkillsForPrompt()` 和 `ResourceLoader.reload()`。CloudCrane 不创建私有 Skill Parser、Skill JSON、Skill 数据库、Marketplace 或依赖解析器。

Pi 的实际语义是：扫描 Skill 目录时先读取 frontmatter metadata；metadata 被格式化到 system prompt；Skill 正文仍通过模型可见的逻辑路径按需 `read`，不是启动时把所有正文注入上下文。`noSkills: true` 会关闭 Pi 默认 Skill 目录，`additionalSkillPaths` 仍显式加入 Website mirror，因此是本项目有意使用的受限组合。

## 数据流与边界

```text
/workspace/AGENTS.md
/workspace/.agents/skills/
        ↓ Workspace Gateway（远程、受限）
Agent Service per-Website mirror
        ↓ additionalSkillPaths
Pi ResourceLoader
        ↓ metadata in context / body on demand
Website Agent
```

Skill 只能提供 SOP、references 和 Remote Bash helper；权限仍由 System Prompt、Tool Policy、Workspace Gateway、Runner sandbox 和生产策略决定。Skill 不能访问其他 Website、Docker Socket、Agent Service 主机、ECS secret 或公网生产控制面。

## 已实现 / 本轮补齐

| 能力 | 状态 |
|---|---|
| Pi 原生 Skill discovery/metadata | 已实现 |
| Website `.agents/skills` 远程镜像 | 已实现 |
| 逻辑路径映射为 `/workspace/.agents/skills` | 已实现 |
| session reload 后刷新 Skill | 已实现 |
| 远程读取失败保留旧 mirror | 已实现 |
| 超大文件/总大小超限不替换旧 mirror | 本轮补齐 |
| symlink Skill 拒绝 | 本轮补齐 |
| Pboot 默认 `pboot-template-migration` | 已实现 |
| Pboot 默认 `pbootcms-upgrade` | 本轮补齐 |
| Skill name collision/诊断暴露 | Pi 原生提供，Runtime 记录数量 |

## 官方 Skill 工程规范

- 目录名使用小写 kebab-case；frontmatter 必须包含 `name` 和面向模型的 `description`。
- `SKILL.md` 只写流程、决策、工具边界和失败条件；详细资料放 `references/`，可执行辅助逻辑放 `scripts/`。
- 脚本必须通过 Remote Bash 在 Website Workspace 执行，不得在 Agent Service 主机执行。
- 官方 Skill 随受管 Workspace 镜像初始化到 `/workspace/.agents/skills/`，后续随 Website Git/Snapshot 按 Tech-06 规则管理。
- 版本事实来自 Trusted Release Registry 与官方源码，不在 Skill 中硬编码“最新版”。
