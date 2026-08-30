# Logging Reference

- 统一使用 Pino 结构化 JSON；生产代码禁止 `console.log`。
- 在服务、请求、Agent run、Workspace 操作和远程调用边界传播并记录 `service`、`traceId`、`requestId`、`websiteId`、`workspaceId`、`sessionId`、`agentRunId`、`runnerId`、`operation`、`durationMs`、`status`（按上下文取适用字段）。
- `traceId`/`requestId` 必须跨 HTTP、WebSocket、Gateway、Runner 和异步操作传播；在调用开始、完成、失败、超时、取消和冲突处记录耗时与结果。
- 使用 `debug` 表示细节，`info` 表示生命周期，`warn` 表示可恢复异常，`error` 表示失败；错误使用结构化 `err`/`errorCode`/`stack`，不要只拼接字符串。
- 永不记录密钥、Token、Cookie、认证头、完整大 Prompt、文件内容、用户秘密或未过滤的外部进程 stdout。需要诊断时记录大小、摘要、标识和安全元数据。
- 一次 Agent run 应可用 `traceId` 串起会话、工具、Workspace、Runner 和结果事件。
