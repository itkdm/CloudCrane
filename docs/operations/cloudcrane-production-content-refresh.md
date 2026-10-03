# Production 内容刷新到 Workspace

此操作把 Production 的 PbootCMS SQLite 数据库和 `static/upload` 内容复制到对应 Workspace，供 Agent 和 Preview 使用。入口位于 Website Settings 的 Production 区域。它只同步内容，不同步正式站代码、授权信息、Production 配置或运行时 Session。

## 数据方向与影响

```text
Production SQLite + uploads → Workspace SQLite + uploads
```

- Production 是内容源。刷新流程不会对 Production 数据库或上传目录执行写入。
- Workspace 的 `data/pbootcms.db` 与 `static/upload` 会被正式站内容替换。Workspace 代码、模板和其他文件保留。
- 替换前比较 Production 快照与当前 Workspace 数据库的 SQLite schema 指纹。结构不同则在修改 Workspace 前拒绝刷新；先同步代码或完成兼容迁移，再重试。
- 操作要求 Production 处于 active 且已授权；开始时拒绝已有 PENDING/RUNNING Agent run 和正在发布的 Website。
- 刷新期间阻止新的 Agent run 与发布操作进入。Production 网站继续对外服务。
- Production SQLite 使用 PHP `SQLite3::backup()` 在线备份，并执行 `PRAGMA integrity_check`。上传目录在备份前后和复制后比较 SHA-256 清单；如果目录在复制窗口内有变化，刷新会失败并要求重试，避免把时间点不同的数据库与上传内容拼在一起。
- 替换前在 Workspace 持久目录保留数据库、SQLite sidecar 和上传目录备份。Preview 在替换时停止，替换后重新启动并再次检查数据库完整性；启动或检查失败时恢复原 Workspace 内容。持久恢复标记使 Runner 重启后可以在 Workspace 再次启动前回滚未完成替换。
- 暂存目录、备份和文件切换由无网络的临时 helper container 在 Workspace 持久卷中执行，文件归属保持为 Workspace UID 1000。Runner 不需要直接写入容器拥有的目录，也不需要放宽 Workspace 目录权限；helper 完成后立即删除。
- 正式数据库只通过 SQLite Online Backup 读取。禁止通过普通文件复制读取正在使用的 `cloudcrane.db`。

## 操作步骤

1. 在 Settings → Production 点击“从正式网站刷新工作区”。
2. 确认将覆盖 Workspace 当前数据库和上传文件。
3. 等待操作结果。成功提示包含复制的上传文件数量，并表示 Preview 已重新就绪。
4. 打开 Preview 检查需要修改的页面，再让 Agent 继续工作。

浏览器刷新或 Web 响应丢失时，页面用相同 Idempotency-Key 查询操作状态。运行中的操作通过持久 operation 记录和 Runner 幂等键避免重复替换。

## 当前范围与已知限制

- 第一版仅覆盖 SQLite 数据库和 `static/upload`。PbootCMS 授权文件、Production 受管配置、Session、缓存和 Release 代码属于各自 Runtime，不复制到 Workspace。
- 上传快照通过清单校验保证复制窗口内文件树稳定。Production 继续服务；持续上传导致清单变化时，本次操作会失败而不是发布不一致快照。
- schema 指纹只能确认 SQLite 对象定义相同，不等同于完整应用兼容性验证；刷新不会迁移 Workspace 代码。
- 上传数据会临时同时占用 Production、Workspace 和 Runner 的刷新制品空间。Runner 成功或失败后会清理本次临时制品；异常退出时，操作状态和 Workspace 恢复标记用于重试及恢复。
