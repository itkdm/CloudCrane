# CloudCrane 模板广场 V1

## 边界与事实来源

- `template` 表是 Catalog Metadata 的事实来源。
- `TEMPLATE_ARTIFACT_ROOT` 是私有、不可变 ZIP Artifact 的事实来源；Artifact 不通过浏览器直接访问。
- `website_template_attachment` 固定 Website 实际使用的 Artifact key、SHA-256 和 Reference 状态。
- Agent Service 拥有 Reference materialization；Runner 只按既有 Workspace Reference 机制以只读方式挂载。
- Website 是 Demo 的所有者。模板广场不会创建第二套 Demo Runtime，`demoUrl` 只是已独立部署样例站的链接。

## V1 发布路径

V1 不实现完整 Marketplace 或用户投稿后台。运营人员使用经过审核的 ZIP 导入：

```bash
pnpm template:publish --archive=/secure/approved-template.zip \
  --name=企业展示 \
  --description=适用于企业展示的网站起点 \
  --category=企业官网 \
  --demo-url=https://example.invalid
```

导入器只允许 `template/`、`skin/`、`static/` 三类主题目录，拒绝管理员、认证、授权、Secret、运行时、缓存、日志、Git 和符号链接。导入时独立计算 SHA-256，并使用不可覆盖的随机 Artifact key。已发布 Artifact 不允许原地更新；内容更新必须发布新的 Template。

仓库内 `templates/official-enterprise` 是用于验证发布链路的最小官方样例，不代表完整生产主题。生产发布前应使用经过产品和安全验收的真实 PbootCMS 主题 ZIP。

## 使用模板与失败恢复

```text
POST /api/websites { name, templateId }
→ 校验 published Template
→ 创建普通 Website + Workspace
→ 初始化 Managed PbootCMS Base
→ Agent Service 校验 Artifact SHA-256
→ 原子 materialize 到该 Workspace 的只读 Reference
→ authorization_required
```

Template Reference 失败不会删除已经创建的 Website/Workspace，而是保留 `template_attach_failed` 和关联失败信息。可以调用：

```text
POST /api/websites/:websiteId/template-attachment/retry
```

重试使用 attachment 中固定的 Artifact key/hash，不重新读取当前 Catalog，也不会重复创建 Website 或 Workspace。
