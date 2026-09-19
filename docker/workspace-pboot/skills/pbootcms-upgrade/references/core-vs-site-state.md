# Core 与 Site State 边界

## Managed Core

由 CloudCrane Trusted Release Registry 和镜像 Managed Base 决定：`apps/`、`core/`、入口文件、`config/database.php`、`rewrite/` 以及 `.cloudcrane/bootstrap.json`。发现 drift 时不能直接覆盖，应生成报告并人工决定移植方案。

## Site State

网站主题、模板、静态资源、业务内容、站点展示配置、`AGENTS.md` 和 `.agents/skills/` 属于 Website 项目状态，可以随 Snapshot 保存，但不能借此携带外部授权、管理员、会话或运行时状态。

## Managed State / Ephemeral

域名、数据库路径、授权、管理员和实例绑定必须以目标 Website 为准重新绑定；`runtime/`、缓存、日志、Session、`.git/`、Reference 和 CloudCrane 内部临时目录不得从来源覆盖。

仓库根目录的 `.agents/` 是本地 Codex 配置，和 Website 的 `/workspace/.agents/` 不是同一个边界。
