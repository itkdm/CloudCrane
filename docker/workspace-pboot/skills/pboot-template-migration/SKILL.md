---
name: pboot-template-migration
description: Rebuild a read-only PbootCMS reference snapshot in the managed CloudCrane Workspace.
---

# Pboot 模板迁移

你需要处理两个刻意分离的目录树：

- `TARGET`：`/workspace`，即可写的 CloudCrane 网站工作区，运行着受管的 PbootCMS 运行时。
- `REFERENCE`：由当前激活的 `reference_upload` 工具返回的路径，例如 `/workspace/.cloudcrane/references/ref_xxx`，以只读方式挂载。不要假设固定的参考 id 或 `template-source` 目录。

本任务的目标是理解参考站点，并在 TARGET 中重建其视觉结构、内容呈现、资源以及所需的站点数据。这不是要求升级或整体复制旧站点。

## 修改 TARGET 前先检查

先在 TARGET 中执行 `git status --porcelain`。首先使用 `read`、`ls`、`find`、`rg`、`cat` 以及只读的 SQLite 检查来检视 REFERENCE。识别 Pboot 版本、当前主题、模板布局、CSS/JS/图片依赖、外部服务、数据库类型，以及页面实际使用的数据。

在迁移数据之前先理解页面：页头、导航、主视觉/横幅、产品、新闻、公司信息、链接、联系方式、页脚，以及哪些部分是静态的、由 Pboot 标签驱动的、由数据库支撑的，或是由 JavaScript 驱动的。

将 TARGET 中受管的 PbootCMS 运行时与参考站点进行对比，选择常规的编码操作，如 COPY（复制）、ADAPT（适配）、REWRITE（重写）或 SKIP（跳过）。不要创建迁移计划 DSL，也不要要求固定的表/文件清单。

## 硬性边界

REFERENCE 是文件系统只读的。先读取当前激活的 `reference_upload` 工具结果或当前上下文以确认其路径。绝不要从中写入、编辑、删除、执行 chmod、执行 PHP 或 shell、启动其旧 Pboot 站点、使用其旧后台管理，或使用其授权信息。绝不要尝试逃逸参考挂载目录或访问宿主机文件。

TARGET 是唯一可写的站点。CloudCrane 受管的运行时保持权威性：不要整体复制或替换 `core/`、`apps/`、`admin.php`、`index.php`、核心 `config/`、授权逻辑、运行时/系统状态或升级状态。如果某项功能依赖被修改过的旧 Core 或 apps，且无法在受管版本中安全地重建，请停止并报告 `CORE_COMPATIBILITY_BLOCKER`，附上相关的源路径与原因。

绝不要迁移旧的授权信息（`sn`、`sn_user`、`licensecode`）、管理员账户/密码/角色、会话、日志、安全状态或系统升级状态。保留 TARGET 的授权信息和管理员数据。不要整体替换 TARGET 的 SQLite 数据库；应检视参考数据库，仅使用 TARGET 当前的 schema 写入重建页面实际所需的站点数据。

不要假设固定目录如 `template/`、`skin/` 或 `static/upload/`。应遵循真实的参考内容，仅迁移所需的安全资源。未经分析，绝不要复制整个旧的 `static/`、`core/` 或 `apps/` 目录树。

## 验证结果

每次完成有意义的改动后，使用现有的 Preview 工具：

1. `preview_refresh`
2. `preview_observe`
3. 检查 DOM/文本以及 console/network 证据。

在桌面宽度 1440 和移动宽度 390 下检查主页。在宣告成功之前，修复损坏的 CSS、JS、图片路径、重要的 console 错误以及大量 404。如果 Preview 不可用或缺少授权，应如实报告，而不是绕过它。

提交前，运行 `git diff --check`，检视 `git diff`，并确认只有预期的 TARGET 文件发生了改动。一次迁移对应一次聚焦的提交。绝不要使用 force push 或破坏性的 Git reset/clean 命令。
