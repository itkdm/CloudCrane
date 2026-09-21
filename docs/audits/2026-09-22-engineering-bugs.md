# CloudCrane Engineering Audit — 2026-09-22

本文件只记录经过证据确认的工程 Bug；候选问题在确认前不计入最终数量。

## 审计基线

- Base: `23fa66d` (`main` 与 `origin/main` 对齐)
- 审计范围：Web、Agent Service、Workspace Gateway、Runner、Preview、附件、数据库与部署运行路径
- 规则：先复现/证明，再修复；产品取舍不计入本表

## Regression Matrix

| ID | 真实路径 | 状态 | 回归证据 |
| --- | --- | --- | --- |
| CC-SEC-001 | Preview Gateway / Agent Service 生产配置 | E2E_VERIFIED | targeted config tests; commit `c15fa39`; ECS health 200; DEVTOOLS page/screenshot verified |
| CC-SEC-002 | Workspace Gateway 生产配置 | E2E_VERIFIED | targeted config tests; commit `c15fa39`; ECS health 200; DEVTOOLS page/screenshot verified |
| CC-SEC-003 | Agent Service HTTP/WebSocket 鉴权 | E2E_VERIFIED | Agent socket/config tests; commit `c15fa39`; ECS health 200; DEVTOOLS page/screenshot verified |
| CC-SEC-004 | Agent session snapshot 错误映射 | E2E_VERIFIED | targeted Agent Service tests; commit `c15fa39`; DEVTOOLS website list/session requests verified |
| CC-DATA-004 | Session metadata 创建失败留下 Pi 文件 | E2E_VERIFIED | `packages/website-agent/src/runtime.test.ts`; commit `47b6e0b`; ECS deploy and DEVTOOLS page/screenshot verified |
| CC-AGENT-001 | Runtime 首次加载未恢复 stale AgentRun | E2E_VERIFIED | `apps/agent-service/src/application/runtime-registry.test.ts`; commit `47b6e0b`; ECS deploy and DEVTOOLS page/screenshot verified |
| CC-AGENT-002 | stale-run 恢复失败泄漏 runtime | E2E_VERIFIED | runtime-registry failure cleanup test; commit `47b6e0b`; ECS deploy and DEVTOOLS page/screenshot verified |
| CC-DATA-002 | Attachment 删除失败后错误标记 deleted | E2E_VERIFIED | `apps/agent-service/src/infrastructure/attachment-service.test.ts`; commit `c17ad17`; ECS deploy and DEVTOOLS page/screenshot verified |
| CC-DATA-006 | Expired attachment cleanup 竞争覆盖状态 | E2E_VERIFIED | `apps/agent-service/src/infrastructure/attachment-service.test.ts`; commit `c17ad17`; ECS deploy and DEVTOOLS page/screenshot verified |

## Confirmed Bugs

> 每条记录必须包含独立 Root Cause、复现证据、回归测试、独立 Review、部署和 DEVTOOLS MCP 证据后，才可进入 `E2E_VERIFIED`。

### CC-SEC-001 — Preview 签名密钥可回退为公开开发默认值

- Root cause：生产配置未强制要求 `PREVIEW_SIGNING_SECRET`，Preview Gateway 与 Agent Service 都会接受公开开发密钥。
- Evidence：`apps/preview-gateway/src/config.ts`、`apps/agent-service/src/config.ts`。
- Fix：生产环境缺失或使用开发默认值时拒绝启动。
- Review：独立子智能体复核通过；建议后续移除 schema 内开发默认值并增加熵检查。

### CC-SEC-002 — Workspace Gateway 内部 Token 可回退为公开开发默认值

- Root cause：生产环境缺少 `WORKSPACE_GATEWAY_CLIENT_TOKEN` 或 `RUNNER_AUTH_TOKEN` 时使用固定开发值。
- Evidence：`apps/workspace-gateway/src/config.ts`。
- Fix：生产环境缺失或使用开发默认值时拒绝启动；Agent Service 同步拒绝开发 client token。
- Review：独立子智能体复核通过。

### CC-SEC-003 — Agent Service 鉴权依赖缺失时 HTTP/WebSocket fail-open

- Root cause：`auth` 或 `db` 未注入时 HTTP hook 直接放行，WebSocket 直接升级连接。
- Evidence：`apps/agent-service/src/app.ts`、`apps/agent-service/src/transport/agent-socket.ts`。
- Fix：生产环境返回 503/拒绝 WebSocket；开发测试模式保持现有测试注入方式。
- Review：独立子智能体确认这是独立 P1，并要求继续补 production request-level regression test。

### CC-SEC-004 — Session snapshot 把任意内部错误误报为不存在

- Root cause：通过错误消息是否包含 `session` 判断 `SESSION_NOT_FOUND`，数据库/文件系统故障也会被映射为 404。
- Evidence：`apps/agent-service/src/app.ts` 原 `getSnapshot` 实现。
- Fix：仅接受 `WebsiteAgentRuntimeError.code === 'SESSION_NOT_FOUND'`，其他错误保留为统一内部错误路径。
- Review：独立子智能体确认原实现不可靠；专门错误映射测试已补齐并随 `c15fa39` 部署验证。

### CC-DATA-004 — Session metadata 创建失败留下 Pi 文件

- Root cause：Pi 先分配持久化 session 文件路径，数据库 metadata 插入失败时没有补偿清理。
- Evidence：`packages/website-agent/src/runtime.ts` `createSession` 的文件分配与 metadata 插入顺序。
- Fix：metadata 创建失败时删除已分配的 session 文件；删除失败仍保留原始数据库错误并由后续扫描策略处理。
- Test：使用真实临时目录和受控 SessionManager 文件，验证 DB 失败后目录为空。

### CC-AGENT-001 — Runtime 首次加载未恢复 stale AgentRun

- Root cause：`recoverStaleRuns()` 只有实现，没有接入 runtime registry 的真实创建路径。
- Fix：每个 Website runtime 首次加载后先执行 stale-run recovery，再对外提供 runtime。
- Scope：按需恢复首次访问的网站；全量启动恢复仍记录为后续运维/架构候选，不在本条重复计数。

### CC-AGENT-002 — stale-run 恢复失败泄漏 runtime

- Root cause：runtime 已创建后恢复失败，registry 只移除 Promise，不调用 runtime shutdown。
- Fix：恢复失败时关闭 runtime 后再向调用方抛错。
- Test：恢复抛错时断言 shutdown 一次且 registry 不保留失败 runtime。

### CC-DATA-002 — Attachment 删除失败后错误标记 deleted

- Root cause：`ConversationAttachmentService.remove` 删除对象失败时吞掉存储异常，仍继续把元数据标记为 `deleted`，导致数据库状态与实际对象不一致且无法可靠重试。
- Evidence：删除路径先调用 storage adapter，原实现把失败转换为成功状态；针对 OSS/local 共同抽象均成立。
- Fix：对象删除失败直接返回失败，不写入 `deleted`；保留 `ready` 记录供用户或清理 worker 重试。
- Test：storage delete 抛错时断言服务失败且 metadata update 未执行。

### CC-DATA-006 — Expired attachment cleanup 竞争覆盖状态

- Root cause：清理 worker 虽然先以 `ready → deleting` 条件抢占，但成功删除后的最终更新原先只按 ID 写入，可能覆盖其他 worker 已经改变的状态。
- Evidence：两个 worker 可同时读取同一过期记录；没有状态条件的最终 update 会把非本 worker 的状态写成 `deleted`。
- Fix：抢占使用受影响行数 CAS；成功和失败回写都限定当前状态为 `deleting`，失败恢复为 `ready` 并记录可重试错误码。
- Test：抢占失败时不删对象；成功和失败路径均覆盖两阶段更新。

## Candidates / Needs More Evidence

| ID | 领域 | 候选问题 | 当前证据 | 下一步 |
| --- | --- | --- | --- | --- |
| CC-DATA-001 | Attachment lifecycle | Session/Website 删除后对象存储孤儿 | 静态链路已确认；需按本地/OSS 实际对象补偿策略设计 | 设计可追踪的删除任务或先清对象再删元数据 |
| CC-DATA-002 | Attachment lifecycle | 删除失败后错误标记 deleted | 已有 storage failure 复现和回归测试 | 已修复并完成线上部署验证 |
| CC-DATA-003 | Attachment quota | 并发上传 TOCTOU | 两次 quota 查询与插入无锁 | 设计事务/预留记录并补并发测试 |
| CC-DATA-004 | Session lifecycle | Pi 文件与 DB 创建非原子 | 已完成补偿清理和故障测试 | 已修复并部署 |
| CC-DATA-005 | Runtime recovery | stale AgentRun recovery 未启动 | 已接入首次 runtime 加载 | 全量启动恢复仍是后续候选 |
