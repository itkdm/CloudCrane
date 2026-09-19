# 模板元数据规则

发布前需要确定：

- `name`：简洁、可识别的模板名称。
- `description`：说明适用场景和主要页面，不夸大未验证能力。
- `category`：使用当前 Template Catalog 支持的分类；无法从 Website 合理判断时再询问。
- `sourceWebsiteId`：始终是当前 Website 的真实 ID，不允许手填其他 Website。
- `demoUrl`：真实存在且可访问的 CloudCrane Website/Preview 地址。没有真实地址时留空并说明，不得拼接或虚构 URL。
- `coverUrl`：优先复用当前已有 Cover 或已验证资源；没有就留空或按当前 API 约束询问，不实现新的截图服务。

先复用 Website、Catalog 或当前发布能力已经知道的值，只询问真正缺失且必须由用户决定的字段。模板发布成功后这些元数据属于已发布 Snapshot 的记录，不能通过修改旧 Artifact 进行更新；需要新版本时从源 Website 重新发布。
