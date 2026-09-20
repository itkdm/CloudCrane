# CloudCrane 可观测性架构基线

## 目标与边界

CloudCrane 的可观测性分成四类信号：

1. 运行日志：服务生命周期、请求、连接、操作结果和安全错误摘要；
2. 分布式关联：HTTP、WebSocket、AgentRun、Workspace operation 与 Runner/Daemon 的关联字段；
3. 审计事件：面向控制面 mutation 和远程 Tool Call 的不可变事实记录；
4. Agent/Workspace 诊断：只记录操作类型、状态、耗时、大小、哈希和错误分类，不记录 Prompt、文件内容、命令输出或凭据。

这四类信号不是同一张表，也不互相替代。日志适合排障，trace 适合跨服务时序，audit 适合回答“谁在何时对哪个资源做了什么”，诊断字段适合定位 Agent/Workspace 边界问题。

## 关联字段契约

`@cloudcrane/observability` 保留旧 `createLogger(service)` API，并通过 AsyncLocalStorage 自动注入上下文。日志基础字段为 `timestamp/level/service/environment/version/commitSha/region/event/message`；上下文按需包含 `requestId/traceId/parentSpanId/spanId/runCorrelationId/userId/websiteId/workspaceId/sessionId/agentRunId/runnerId/connectionId/operation`，未提供的字段不会输出。`parentSpanId` 表示入站 W3C 父 span，`spanId` 表示当前服务实际创建的 span。

现有协议中的 UUID `traceId` 是 AgentRun/业务关联字段，不能重命名或伪装成 OpenTelemetry trace id。进入新日志字段时应映射为 `runCorrelationId`；真正的 W3C `traceId` 为 32 位十六进制，`spanId` 为 16 位十六进制。`parseTraceparent()` 只接受有效的 W3C `traceparent`，不会修改现有协议 envelope。

## 日志与脱敏

所有新代码使用 Pino 和 `createLogger`。生产禁止 `console.log`。共享 logger 配置统一级别、版本元数据和 Pino redact；错误使用 `serializeError()`，只保留错误类型、受限错误码和脱敏后的短消息。

禁止输出：密码、Cookie、Authorization、Token/API Key、Secret、完整 Prompt/Response、工具输入输出、Shell/stdout/stderr、环境变量、数据库/Session/Reference 内容和授权码。业务诊断只允许状态、计数、大小、哈希、资源 ID 和稳定错误码。外部错误消息不能直接写入用户响应或 `errorMessage`。

## 审计事件

`audit_event` 是控制面唯一审计表，业务对象 ID 作为不绑定外键的证据引用保存；业务对象删除时不能回写或删除审计记录。状态为 `PENDING/RUNNING/SUCCESS/FAILED/TIMEOUT/CANCELLED/UNKNOWN`；跨 PostgreSQL 与 Docker/Runner 的操作应先提交 PENDING，远程执行后再写终态。连接中断且结果不确定时只能写 UNKNOWN，不能误记 FAILED 或自动重试。

`request_summary/result_summary/metadata` 通过数据库层的安全摘要过滤，仅允许标量、短字符串和非敏感键。Tool Call、Pi 和 AgentRun 通过 `requestId/toolCallId/agentRunId/runCorrelationId` 关联，不建立第二套重复审计。

审计终态写回必须遵循 commit-point 语义：业务 mutation 尚未完成时失败可记为 `FAILED`；业务 mutation 已完成但审计终态写回失败时只能保留为 `UNKNOWN` 并记录告警，不能把已成功的业务结果改写为 `FAILED`。只读 Workspace operation 不创建 mutation audit。

当前已接入审计的高价值变更包括：Website 创建、Pboot 授权、AgentRun 生命周期、Agent Session 创建/重命名/置顶/克隆/删除、Template Publish，以及 Workspace Gateway 的运行时和 Snapshot 操作。会改变外部状态的操作在执行前创建 `PENDING`；审计创建失败时不执行变更，终态写回失败时对调用方报告结果不确定。尚未存在于当前产品边界的 Pboot 升级、生产发布和回滚流程，不伪造审计记录，待对应业务能力落地时沿用同一契约。

## 部署与采集

Node 服务默认输出 JSON stdout；当前 tmux 启动脚本同时通过 `tmux pipe-pane` 写入受控的 `/var/log/cloudcrane/*.log`，Alloy 采集这些应用日志。systemd 部署则由 journald 管理；应用不自行创建无限增长的日志文件。PostgreSQL Compose 和 Workspace Docker 应使用 `json-file` 的大小/文件数限制。Preview Nginx 模板关闭 access log，避免 URL token 进入访问日志；主站模板显式定义 CloudCrane access/error 日志路径，主机通过 logrotate 或 journald 配置保留周期。

`deploy/systemd` 和 `deploy/alloy` 只提供可审查模板，不会自动修改 ECS，也不会替换当前 tmux 生产进程。Alloy 的 journal source 仅匹配 `cloudcrane-*.service`；tmux 应用日志使用文件 source。集中采集器必须从主机私有配置注入 endpoint/凭据；仓库模板不包含真实 Secret，也不采集 Workspace 内容。

## 当前实现状态与接入顺序

基础包、Pino 脱敏、AsyncLocalStorage Context、W3C traceparent 解析、OTel 可选启动、Workspace Gateway
operation audit、Runner/Daemon 的 correlation 传播、`audit_event` schema 和 systemd/Alloy 模板已经建立。
OTel 没有配置 endpoint 时不会阻塞业务启动，也不会替代 Pino。

Drizzle journal 在早期版本存在历史时间戳倒序（已执行历史不可重写）。`db:migration:check` 将这段历史视为固定基线，校验索引、SQL 文件与 tag 一一对应，并要求基线之后的新 migration 时间戳严格递增；新增 migration 必须使用大于当前最大值的时间戳，不能重新整理已执行历史。

当前接入顺序仍为：Workspace Gateway operation → AgentRun 生命周期 → Website/template mutation →
Pboot 授权 → Template publish → Runner/Daemon。已有测试覆盖基础包、脱敏、审计摘要、AgentRun 和
Workspace 运行路径；Docker/远程集成用例需要完整环境，不能用本地跳过结果替代通过。未配置 OTel
Collector 时只能验证应用保持可用和日志字段，不宣称后端 Trace 已接收。

## 运维查询建议

优先按 `traceId + spanId` 查询跨服务时序，按 `runCorrelationId + agentRunId` 查询一次 AgentRun，按 `operation + status + occurredAt` 查询审计。日志查询结果不得复制原始请求体、Prompt、响应、命令输出或 Secret 到工单。
