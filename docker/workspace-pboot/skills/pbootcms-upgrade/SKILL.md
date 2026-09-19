---
name: pbootcms-upgrade
description: Analyze and safely plan or perform a PbootCMS managed-core upgrade using CloudCrane's trusted release registry, snapshot boundaries, official migrations, and Preview verification.
---

# PbootCMS 版本化快照恢复与 Managed Core 迁移

这是受限的版本化快照恢复与 Managed Core 迁移 SOP，不是任意 Website 在线升级器，也不是官方 PbootCMS 全包覆盖脚本。CloudCrane 还必须隔离 Managed Core、Managed State、Reference 和 Runtime，并通过 Workspace 原子 promote。先分析，再计划；只有用户明确确认计划后，才执行确定性能力。

## 适用边界

- 目标工作区是 `/workspace`，只能修改它；不要访问其他 Website、Docker Socket、ECS 凭据或 Agent Service 主机文件。
- 网站长期规则来自 `/workspace/AGENTS.md`；本 Skill 只提供升级流程，不扩大工具权限。
- 先读取本 Skill 的相关 `references/`，再执行步骤。只在需要时读取详细参考，保持上下文精简。
- 不要把当前最新版本写死在回复中。版本和 commit 以 `/opt/cloudcrane/pboot-releases.json`、`/workspace/.cloudcrane/bootstrap.json`、Managed Base marker 和官方 PbootCMS 源码为准。

## 标准流程

1. 执行只读检查：`git status --porcelain`、Pboot 版本 marker、`PRAGMA integrity_check;`、当前 Preview 状态和 Core drift。
2. 读取 `references/core-vs-site-state.md`，把文件分为 Managed Core、Site State、Ephemeral Runtime；禁止把旧站整棵 `apps/`、`core/`、入口文件、授权或管理员数据覆盖到当前工作区。
3. 从可信 Release Registry 和官方仓库确认 source/target 版本、source commit、官方 changelog 及可用 SQLite migration chain。缺少受信任版本或迁移链时必须停止并说明，不自行编写 SQL。
4. 读取 `references/database-migration.md`，判断数据库 schema 是否需要迁移。数据库迁移只能调用镜像内置的确定性工具或现有 Snapshot Apply 流程，不能让模型临时生成 `ALTER TABLE`。
5. 生成升级计划，明确：目标版本、Core drift 文件、迁移链、保留的 Site State、会被重新绑定的 Managed State、验证和回滚点。必须列出来源/目标版本、manifest、bootstrap marker、实际 schema 的一致性检查结果；存在 Core drift、二次开发冲突、缺少迁移链或授权风险时先请求用户确认。
6. 无 drift 且已有受信任确定性升级能力时，按现有 staging → migration → integrity check → validation → promote 流程执行。当前 Workspace 镜像已提供 Snapshot Apply 和 SQLite migration 原语；不要假装它们是任意在线 Core 覆盖器。
7. 有 drift 时只分析并迁移必要差异：逐文件分类为可丢弃、等价迁移、Site Layer、必须移植或需要确认；不得静默覆盖用户二开。
8. 执行后用 Preview 在桌面和移动宽度验证，检查页面、Console、Network、数据库完整性、Git diff 和刷新后的持久化状态。读取 `references/verification.md`。

## 失败条件

遇到以下任一情况，停止在分析/计划阶段：版本未在 Registry 中受信任、官方迁移链缺失、TypeScript planner 与 PHP runtime 的迁移声明不一致、来源/目标版本或 schema 元数据不一致、Core drift 未审查、数据库完整性失败、无法保证来源管理员/授权/实例状态被忽略或按目标确定性 Rebind、Preview 不可用，或确定性升级能力无法提供原子 staging/rollback。staging backup 只是本次操作的临时回滚点，不等同于持久化备份。

升级报告必须只输出脱敏状态、版本、文件计数、迁移名称和失败码；不得输出密码、授权码、Token、Cookie、完整数据库内容或完整 Prompt。

## 当前支持范围

当前确定性迁移原语覆盖受信任的 PbootCMS SQLite Snapshot 路径，已登记的 `3.2.24 → 3.2.26` 是当前可验证链路。未知版本、降级、跳过中间迁移、MySQL Snapshot 自动恢复和直接全包覆盖均不支持。当前镜像中的 PHP migration runner 与 TypeScript planning registry 仍是两个实现面；两者声明不一致时必须停止，升级报告必须以实际 runtime 能执行的链为准，不能把规划清单当成已执行证据。
