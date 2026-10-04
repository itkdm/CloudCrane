# CloudCrane 权限、套餐、权益与可替换支付架构方案

状态：架构方案；代码状态最近核对于 2026-10-04

范围：第一阶段的设计与落地边界，以及本轮已落地的数据库/Core 原型；不包含支付账户配置或商业价格最终确认。

> 实施状态（2026-10-04）：当前代码包含 `packages/billing` 的权益解析/配额决策能力、Billing Account/Plan/Entitlement/Operation/Usage/Provider Connection/Provider Event Inbox schema、Website-Workspace 唯一约束、个人 Billing Account 绑定、Provider-neutral adapter、Website 创建/删除操作流程、附件配额预留，以及 Production Runtime/Release schema 和 Publish 流程。基础结构不等于完整商业计费：实际套餐定价、通用资源准入、支付 Webhook 消费和收费流程仍未交付。

## 1. 最终结论

CloudCrane 不应把套餐字段直接塞进 `user`、`website` 或 `audit_event`，也不应把 Waffo 的 Product、Subscription 或 Webhook 状态当作平台唯一真相。

最终采用四层模型：

```text
身份与资源授权
  user / membership / website / workspace
              ↓
计费主体与套餐
  billing_account / plan_version / subscription / grant
              ↓
平台权益与用量
  entitlement resolver / quota decision / usage event / reservation
              ↓
支付适配器
  Waffo adapter / future Stripe adapter / future provider adapter
```

Waffo 可以作为第一阶段支付供应商，但只能是 `PaymentProviderAdapter`。未来切换其他支付方案时，核心套餐、权益、配额、状态机和资源授权不变，只替换适配器及其 Webhook 归一化实现。

本方案明确区分：

- **能不能访问某个 Website**：资源授权问题，当前仍由 `website.owner_id` 和后续 membership 负责；
- **账户是否有资格创建/使用某类资源**：权益与配额问题；
- **用户是否已经付款**：支付 Provider 事实和 CloudCrane 内部订阅投影；
- **实际用了多少空间、流量或 Agent 资源**：可信来源产生的追加式用量事件。

## 2. 交叉调研与审查结论

本节记录 2026-09-23 初始调研和交叉审查时的发现，表中“当前”均指该次审查时点；已被后续实现解决的项以第 3 节当前代码事实为准：

| 主题 | 代码架构审查 | 支付/生态审查 | 最终处理 |
|---|---|---|---|
| `billing_account` | 需要稳定主体、幂等创建、不可级联删除历史 | Provider 不应成为主体真相 | 采用独立 Billing Account；当前个人账户幂等映射到用户 |
| Provider Adapter | 不能让支付状态绕过资源授权 | Waffo 只负责支付动作与事件 | 采用 Provider-neutral adapter 与 external reference |
| Website/Workspace | 当前没有 `workspace.website_id` 唯一约束 | 重复资源会导致配额错误 | 作为 P0 前置迁移补齐唯一性 |
| 创建/删除 | 当前外部操作不是数据库事务，缺少业务幂等 | 付款/资源操作必须可重试 | 引入持久化 operation 与 reservation |
| 附件配额 | 现有查询-上传-再查询存在 TOCTOU | 计量必须可重放、可校正 | 先做租约式 reservation，再上传和 finalize |
| Entitlement | `production.count` 是账户聚合配额，不是 Website 状态 | boolean/static/metered 仍需作用域与周期 | 分离 Resolver 与 Quota Decision，显式 scope |
| Webhook | 不能由 `audit_event` 去重 | raw body 验签、Inbox、乱序、重放、reconcile 必须存在 | Durable Inbox + 唯一键 + 异步投影 + 主动 reconcile |
| 付款失败 | 不能只用 `active/restricted` 字符串 | Provider grace 规则不能决定平台行为 | CloudCrane 定义可执行的 capability policy |

因此，本文件不是把初稿原样固化，而是把两路审查指出的前置条件和边界补齐后形成的方案。

## 3. 当前代码事实与影响

当前平台 PostgreSQL 已拥有 Website、Workspace、Session、Agent Run、模板、分享、附件、审计及 Billing/Entitlement 表。当前 schema 包含 Billing Account/Member、Plan/Version、Entitlement Definition/Grant、Subscription、Operation、Quota Reservation、Usage Event/Aggregate、Provider Connection 和 Provider Event Inbox。Inbox 与计费表结构已存在，但不能据此推断 Webhook 处理流程或支付接入已完成。

关键事实：

- Website 的当前授权根是 `website.owner_id`，普通用户只能访问自己的 Website；管理员有统一授权函数的覆盖权限。
- `website.owner_id` 当前可空，用户删除时为 `SET NULL`；旧 Website 不能自动推给第一个新用户。
- 创建流程通过持久化 Operation 与 `Idempotency-Key` 协调数据库和外部 Runtime；这不是跨系统原子事务，失败和重试仍需遵循 operation 状态。
- `workspace.website_id` 已有唯一约束，当前数据模型固定为一个 Website 对应一个 Workspace。
- Website 创建/删除 API 要求业务 `Idempotency-Key`，并使用持久化 Operation 处理并发和重复请求；`audit_event.idempotency_key` 本身仍不是业务幂等机制。
- Website 删除已接入持久化 Operation；外部 Runtime 与数据库之间仍不存在分布式事务，必须把结果不确定和恢复路径作为运行边界处理。
- 附件当前有本地/OSS 存储适配器；生产路径已通过账户级 `Quota Reservation` 串行化附件存储准入，并在对象写入后按实际大小 commit、失败/删除/过期时 release。未注入配额服务的单元测试仍保留旧 Session 限制作为测试替身，不能作为生产授权逻辑。
- `production_runtime` 和 `website_release` 已进入当前 schema，并有 Production Publish/Gateway 实现；不能再写成 Runtime/Release 未落地。当前仍没有完整的生产网站计量/付费准入，因此“正式网站数”不能直接等价于 Workspace 数或已收费订阅数。

相关代码位置：

- [控制面 schema](../../packages/db/src/schema.ts)
- [Website 创建与清理](../../apps/web/lib/server/website-provisioning.ts)
- [Website API](../../apps/web/app/api/websites/route.ts)
- [Website 鉴权](../../packages/auth/src/index.ts)
- [附件服务](../../apps/agent-service/src/infrastructure/attachment-service.ts)
- [附件存储适配器](../../packages/attachment-storage/src/index.ts)
- [认证授权 ADR](./cloudcrane-authentication-authorization-adr.md)

## 4. 领域模型

### 4.1 Billing Account

`billing_account` 是套餐、订阅、用量和支付关系的稳定主体。第一阶段每个用户通过幂等的 `ensurePersonalBillingAccount(userId)` 获得一个个人账户，但数据模型不要写死为永远一用户一账户。

建议字段：

```text
id
kind: personal | organization
status: active | closed
created_at / updated_at / closed_at
```

用户映射单独使用：

```text
billing_account_member
account_id
user_id
role: owner | admin | member
status
```

当前 Website 先保留 `owner_id` 作为既有资源授权/创建者字段；新增 `billing_account_id` 后，所有新创建 Website 必须有明确账户。旧 `owner_id IS NULL` 的 Website 必须由管理员明确归属，不能自动迁移。

用户删除不得级联删除 Billing Account、支付事件、用量事件和审计历史；账户应软关闭，历史主体 ID 必须继续可查询。

### 4.2 Plan 与 Plan Version

套餐是内部产品目录，不直接镜像 Waffo 产品。Plan 可有不可变的版本，新的商业规则发布新版本，不修改已经生效的历史版本。

```text
plan
  key: free | preview | starter | pro | ...
  display_name
  status

plan_version
  plan_id
  version
  currency / billing_interval
  effective_at / retired_at
```

例如产品当前提到的“免费一个预览网站、一个正式网站、五个正式网站”，应表达为内部 Plan Version 的权益，而不是在 Web API 中写 `if user.plan === ...`。

### 4.3 Entitlement、Grant 与作用域

`entitlement` 表达“账户/资源当前拥有什么能力”，`grant` 表达来自订阅、促销、管理员补偿或迁移的额外来源。

每条权益必须明确：

```text
feature_key
scope: account | website | workspace | session | production
value_type: boolean | static | metered
value / unit
hard_or_soft_limit
period: lifetime | billing_period | rolling_window
effective_at / expires_at
source_type / source_id
priority / stacking_policy
```

初期可使用：

```text
preview.enabled                 scope=account
production.enabled              scope=account
production.website_count        scope=account, hard limit
workspace.active_count          scope=account, hard limit
workspace.storage_bytes         scope=account, metered
conversation.attachment_bytes   scope=account or session, metered
traffic.egress_bytes            scope=account or website, metered
template.catalog_access         scope=account, boolean/static
agent.concurrent_runs           scope=account, hard limit
```

注意：`production.active` 是某个 Website 的运行时状态，不是套餐权益；套餐应提供 `production.enabled`，Website 是否实际处于 active 由 Production 生命周期决定。`production.website_count` 是账户聚合配额，也不能建模成单个 Website 的字段。

### 4.4 Subscription

核心订阅至少需要：

```text
id
account_id
plan_version_id
status: trialing | pending_payment | active | grace | restricted |
        canceling | canceled | expired | suspended
current_period_start / current_period_end
cancel_at / canceled_at
next_plan_version_id
provider_connection_id
provider_subscription_ref
version
```

Provider 状态只是输入。CloudCrane 自己定义从 Provider 状态到能力策略的映射，例如 `past_due → grace`，但不能把 Waffo 的短重试窗口直接等同于 CloudCrane 立即禁止或删除资源。

### 4.5 Usage Event 与 Aggregate

计量必须保留可重放的原始事件，聚合表只是查询优化：

```text
usage_event
  idempotency_key (unique within source scope)
  account_id / website_id / workspace_id
  meter_key
  quantity / unit
  occurred_at / billing_period
  source
  correction_of / metadata

usage_aggregate
  account_id / meter_key / period
  quantity
  last_rebuilt_at
```

必须提前固定：单位、精度、账期时间源、迟到事件、重复事件、冲正、重算和保留期限。不能只保存一个当前计数，否则未来无法迁移到 OpenMeter/Lago 或审计计费争议。

### 4.6 Quota Reservation

创建 Website、Workspace、上传附件、发布等操作需要预留，而不是只做一次查询：

```text
quota_reservation
  operation_id
  account_id
  meter_key
  requested_quantity
  status: pending | committed | released | expired
  expires_at
  idempotency_key
```

数据库用行锁、条件更新或原子计数器保证并发安全。外部上传/Runtime 操作失败后释放 reservation；超时由恢复任务回收。reservation 的提交和释放必须幂等。

### 4.7 Operation

Website 创建、删除、Workspace 创建、发布和附件上传都应由持久化 operation 驱动：

```text
operation
  id
  account_id / user_id / website_id
  kind
  idempotency_key
  request_hash
  status: pending | running | succeeded | failed | retryable | canceled
  result_resource_id
  retry_count / last_error
  created_at / updated_at / completed_at
```

数据库事务只保证控制面状态；ECS/Docker、对象存储和其他外部资源必须通过 operation 状态机恢复。HTTP 超时不等于操作失败，客户端重试应返回原 operation 结果或稳定的处理中状态。

## 5. 权益决策职责分离

不要把所有判断塞进一个不可解释的 `canUse()`。

### Entitlement Resolver

输入：

```text
billing subject + scope + effective plan/grant/subscription snapshot
```

输出：可解释的有效权益，包括来源、数值、周期、优先级和状态。

### Quota Decision Service

输入：

```text
effective entitlement + trusted current usage + requested delta
```

输出：

```text
allow | deny | reserve | pending
```

拒绝必须返回稳定错误码，例如 `PLAN_LIMIT_REACHED`、`PAYMENT_GRACE_RESTRICTED`、`STORAGE_QUOTA_EXCEEDED`，而不是在各个 API 中复制文案。

不同资源由不同可信边界执行：

| 能力 | 事实来源/执行点 |
|---|---|
| Website 数量 | Control Plane 事务与 operation |
| Workspace 一对一/活动数 | DB 唯一约束 + Gateway/Runner |
| Workspace 磁盘 | Runner volume 计量，控制面周期校准 |
| 附件大小 | Attachment Service + storage adapter + reservation |
| 模板 ZIP/展开大小 | 模板物化流程 |
| Preview 并发 | Preview Gateway/Runner |
| Agent 并发/次数 | Agent Service |
| 流量 | Preview/Production Gateway 的可信 website 上下文 |

客户端不能上报用量，不能仅凭 Host 头作为流量归属，也不能让支付 Provider 单独执行磁盘/流量/Workspace 限制。

## 6. Waffo 可替换支付适配器

### 6.1 Core 不依赖 Waffo

建议定义：

```ts
interface PaymentProviderAdapter {
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  createPortalSession(input: PortalInput): Promise<PortalResult>;
  cancelSubscription(input: CancelInput): Promise<ProviderOperationResult>;
  resumeSubscription(input: ResumeInput): Promise<ProviderOperationResult>;
  changePlan(input: ChangePlanInput): Promise<ProviderOperationResult>;
  refund(input: RefundInput): Promise<ProviderOperationResult>;
  verifyWebhook(rawBody: Uint8Array, headers: Headers): Promise<VerifiedEvent>;
  normalizeWebhook(event: VerifiedEvent): NormalizedBillingEvent;
  fetchSubscription(ref: ExternalRef): Promise<ProviderSubscriptionSnapshot>;
  reconcile(input: ReconcileInput): Promise<ReconcileResult>;
  reportUsage?(input: UsageReportInput): Promise<void>;
}
```

Core 只保存通用 external reference：

```text
provider_connection
provider_environment
external_object_type
external_object_id
account_id / subscription_id / payment_id
```

不要在核心表中出现 `waffo_order_id`、`stripe_subscription_id` 等供应商专属列。Waffo 的 REST/GraphQL、签名算法、事件名称和字段差异全部封装在 adapter 内。

### 6.2 Webhook 四段式处理

```text
HTTP request
  ↓ 保留原始 body
Adapter 验签和时间窗口检查
  ↓
Durable provider_event_inbox
  ↓ 唯一去重后异步归一化/状态投影
Billing Core subscription/entitlement/operation
```

必须满足：

- 验签前不能 JSON parse 后重新序列化；
- 唯一键至少为 `provider connection + environment + provider event id`；
- 同一事件 ID 但 Payload Hash 不同要进入冲突状态，不能静默覆盖；
- 验签失败返回 4xx，不把敏感正文写入日志；
- 数据库不可用返回 5xx，使 Provider 重试；
- Inbox 落库成功后快速返回 2xx，异步处理业务；
- 处理允许重复、乱序和延迟；
- 失败事件有 retry/dead-letter/replay 能力；
- 必须有主动 `reconcile()`，不能只依赖 Webhook。

Waffo 官方公开资料与 SDK 资料表明其存在订阅、Checkout、Webhook 和签名机制，但正式接入前仍要以账户实际 API/SDK 合约确认事件 ID、签名密钥轮换、完整事件列表、幂等键和 usage 计量能力。不能把营销页上“支持”直接当成已验证的接口契约。

### 6.3 订阅变更与付款失败

- Checkout 创建成功不等于付款完成；升级权益应等待明确的 `payment_confirmed/active` 投影。
- 升级可立即生效，但必须能处理异步付款失败。
- 降级默认下一周期生效；当前周期内保留旧权益。
- 降级后已超出新额度的资产不自动删除：禁止新增、上传或扩容，并向用户给出可执行的清理/升级路径。
- `grace` 期间保留已有数据和既有生产服务，禁止扩大高成本资源；具体禁用能力必须逐项配置，不能只返回一个字符串状态。
- `restricted/suspended` 的 Preview、Production、Agent、Upload 行为需在产品规则中明确；恢复付款后重新计算权益。

## 7. 第一阶段套餐示例

不要在 API 中写死“免费/一个/五个”。以内部 catalog 数据表达：

| Plan Version | preview.enabled | production.enabled | production.website_count | 其他 |
|---|---:|---:|---:|---|
| free-preview | true | false | 0 | 基础模板、有限附件 |
| starter | true | true | 1 | 基础存储/流量 |
| pro | true | true | 5 | 更高存储/流量 |

以上只是当前产品讨论的示例，不是最终售价或商业承诺。任何增加模板、磁盘、流量、Agent Run、团队成员、域名、备份和发布次数的规则，都通过 feature/entitlement 增加，不修改业务代码中的套餐分支。

## 8. 尚未完成的生产化工作

以下清单聚焦当前仍未完成的工作。已落地的账户绑定、基础 Billing Core/schema、Website 创建/删除 operation、Workspace 唯一约束和附件配额预留不再列为待办。

### 资源配额与运维闭环

1. 实现通用 Website/资源配额准入，并定义超额后的产品行为；当前附件配额 reservation 不等于所有资源的统一准入。
2. 完善 Website 删除 operation 的失败恢复、重复请求与外部 Runtime 不确定结果处理，并为这些边界补齐持久化回归验证。

### Billing Core 生产化

1. 固定 UsageEvent 的单位、账期、幂等、迟到、冲正、重算和保留语义，并实现所需投影/重算流程。
2. 将所有资源准入逐步统一到 EntitlementResolver + QuotaDecisionService；清理仍存在的重复配额路径。
3. 建立 capability policy，明确 active/grace/restricted 下各操作的行为；当前不应把 schema 原型当作已生效商业策略。

### 支付 Provider 接入（待账户合约确认）

1. 以实际 Provider 合约确认并验证 checkout、付款、续费、失败、取消、恢复、升级、降级、退款及重复/乱序 Webhook。
2. 实现 raw-body 验签、基于现有 Inbox schema 的事件接收与异步投影、重试/死信和主动 reconcile。
3. 为每个 adapter 操作传递内部 operation/idempotency key，并防止旧变更覆盖新订阅状态。
4. 不把 Waffo Secret 放进 Website、Workspace、Agent 或 Preview。

### P3：计量增强

第一阶段先保留 CloudCrane 自己的 Usage Core，不立即引入 OpenMeter/Lago。需要完整 usage pricing、credits、overage、invoice 或规模化事件处理时，再把 OpenMeter/Lago 接在内部 Meter/Entitlement 层后面，而不是让它们取代 CloudCrane 的资源授权真相。

## 9. 测试与验收要求

### 数据与协议

- 并发创建同一 `Idempotency-Key` 只能得到一个 Website 和一份配额预留；不同 request hash 必须拒绝。
- 并发删除只能有一个执行者，重试可得到稳定 operation 结果。
- `workspace.website_id` 唯一性和迁移前重复数据有真实 PostgreSQL 集成测试。
- 并发附件上传不得超过账户/Session 配额；对象失败、DB 失败、超时回收都要可重试。
- Webhook 验签、重复、乱序、Payload Hash 冲突、数据库暂时不可用和死信都有 contract/integration 测试。
- Provider 状态不能绕过 CloudCrane entitlement policy；过期/降级不应删除网站。
- UsageEvent 重复、迟到、冲正和重算结果可预测。

### E2E

涉及 Web UI、支付 Checkout、订阅状态或 Website 生命周期时，按项目规范使用真实 ECS 完整服务栈和 DEVTOOLS MCP；UI 验收必须截图，不能用本地裸启动 Web、curl 或普通浏览器代替。

## 10. 成熟方案参考

- [Stripe Entitlements](https://docs.stripe.com/api/entitlements/feature)：适合功能型静态权益，但不能单独替代 CloudCrane 的存储/流量/Workspace 配额。
- [Stripe Webhooks](https://docs.stripe.com/webhooks)：原始请求体验签、快速确认和异步处理原则。
- [OpenMeter Entitlements](https://openmeter.io/docs/billing/entitlements/entitlement)：Boolean、Static、Metered entitlement、周期与余额模型。
- [OpenMeter Grants](https://openmeter.io/docs/billing/entitlements/grant)：周期 grant、余额与阈值告警思路。
- [OpenMeter Metering](https://openmeter.io/docs/metering/overview)：事件计量、去重、归属和聚合。
- [Lago 官方仓库](https://github.com/getlago/lago)：usage、pricing、credits、entitlements、invoice、payment 的完整计费链路；但引入成本和许可证边界更重。
- [Waffo API Reference](https://docs.waffo.ai/api-reference/introduction)：API 和认证入口，正式接入前应以账户实际合约复核。
- [Waffo Subscriptions](https://docs.waffo.ai/features/subscriptions)：订阅状态和变更语义参考。
- [Waffo Webhooks](https://docs.waffo.ai/features/integrations)：事件投递与集成参考。
- [Waffo 官方 Go SDK Webhook 源码](https://github.com/waffo-com/waffo-pancake-sdk-go/blob/main/webhooks.go)：签名格式和重放注意事项参考。
- [Keycloak Authorization Services](https://www.keycloak.org/docs/latest/authorization_services/)：身份/组织授权参考；不承担 CloudCrane 支付和计量真相。

## 11. 当前不冻结的产品决策

以下内容不能由架构自行替用户决定，应在实现商业功能前单独确认：

1. Waffo 之外的第一候选支付 Provider，以及是否需要同时支持多个 Provider。
2. 个人账户和未来组织账户的 UI、成员邀请与转移规则。
3. 免费 Preview 的存储/流量/保留时长和分享有效期。
4. 降级超额时 Preview、Production、Upload、Agent Run 的逐项行为。
5. 流量是否硬上限、软提醒、超额计费或直接限速。
6. 生产网站删除、退款、争议和数据保留策略。
7. 何时从内置 Usage Core 迁移或旁路接入 OpenMeter/Lago。

这些未决项不影响先实现 provider-neutral 的内部边界，但不能用默认值偷偷写进支付和资源删除流程。

## 12. 一句话定案

> **Waffo 是可替换的支付入口，不是 CloudCrane 的权限系统；CloudCrane 自己拥有 Billing Account、版本化套餐、权益解析、配额预留、用量事件和资源状态机，先修复 Website/Workspace/附件的一致性基础，再接入 Waffo。**
