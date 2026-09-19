# 升级验证清单

- `git status --porcelain` 与预期一致，未把无关改动纳入升级提交。
- Managed Core marker、Pboot 版本和目标 Release commit 一致。
- `PRAGMA integrity_check;` 返回 `ok`，并检查关键业务表和索引。
- Preview 桌面 1440 宽度和移动 390 宽度均可打开；无关键 Console 错误和大量资源 404。
- 登录、后台入口、首页、导航、主题资源和关键内容可用；授权仍走官方流程。
- 刷新 Website Agent Session 后 Skill metadata 仍可加载；Skill 脚本只通过 Remote Bash 在 `/workspace` 执行。
- 失败时确认旧 Workspace 可恢复，且没有把密码、Token、授权码或完整数据库写入日志。
