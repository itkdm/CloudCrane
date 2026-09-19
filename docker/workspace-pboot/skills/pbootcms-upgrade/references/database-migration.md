# 数据库迁移规则

PbootCMS 官方升级脚本按版本提供，CloudCrane 只信任镜像内置且在 `pboot-releases.json` 注册的迁移资产。先确认 `dbSchemaVersion`，不要仅凭目录名或模型记忆猜测 schema。

流程必须是：

```text
source DB 只读检查
→ staging 副本
→ 受信任官方 SQLite migration chain
→ PRAGMA integrity_check
→ Managed State Rebind
→ 业务验证
→ 原子 promote
```

如果 source schema 高于目标、版本关系不明、迁移资产缺失或 integrity check 失败，必须 fail closed。管理员、授权、实例绑定和会话不属于可从来源数据库直接覆盖的业务内容；目标端状态必须保留或显式重新绑定。

当前 PHP runner 的执行范围仍以镜像内置 runtime 为准；TypeScript registry 用于规划和验证，不能替代 runtime 的实际执行。若两者声明不一致，应停止升级并报告 source-of-truth 漂移，而不是继续执行。
