# systemd 运行模板

仓库同时提供五个明确的生产 unit：

- `cloudcrane-web.service`
- `cloudcrane-agent.service`
- `cloudcrane-workspace-gateway.service`
- `cloudcrane-runner.service`
- `cloudcrane-preview-gateway.service`

`cloudcrane-node@.service` 是便于临时迁移或测试的通用模板。所有 unit 都只引用服务器上的
`/etc/cloudcrane/cloudcrane.env`，不会把 Secret 写入 unit 文件。保留 tmux 作为当前兼容启动方式，
不会自动替换生产进程。

使用前：

1. 创建受限的 `cloudcrane` 用户和 `/etc/cloudcrane/cloudcrane.env`；
2. 确认仓库已构建、`pnpm` 的绝对路径与 `WorkingDirectory`；
3. 先在单个非关键服务上验证日志、停止和恢复，再逐步迁移；
4. 先为单个服务执行 `systemctl daemon-reload`、`systemctl enable --now cloudcrane-*.service` 中的目标 unit，确认日志、停止和恢复后再逐步迁移。

Runner unit 使用 `Group=docker` 访问 Docker Socket；其余服务使用受限的 `cloudcrane` 用户组。

服务输出进入 journald。生产保留周期和磁盘上限由主机 journald 策略配置，不在应用内自行写日志文件。
