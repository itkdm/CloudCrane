# 对话附件第一阶段

对话附件与模板参考 ZIP 是两条不同的生命周期，不能复用 `reference-upload`。

第一阶段支持：

- 图片：PNG、JPEG、GIF、WebP；上传时检查扩展名、MIME 和文件头；
- 文档：TXT、Markdown；服务端读取后作为不可信文本上下文传给 Agent；
- 存储：ECS 私有持久化目录；前端和预览域名不会得到附件公开 URL；
- Pi：图片通过 `session.prompt(text, { images })` 传入，文档限制为文本内容；
- 生命周期：附件默认保存 7 天，由 Agent Service 定时清理。

服务端配置：

```dotenv
ATTACHMENT_STORAGE_DRIVER=local
ATTACHMENT_STORAGE_ROOT=/var/lib/cloudcrane/attachments
ATTACHMENT_MAX_BYTES=20971520
```

启用阿里云 OSS 时，使用服务端 Node.js SDK 和 V4 签名。Bucket 应保持 `private`，Agent Service 只在服务端读写对象，不向浏览器返回公开对象 URL：

```dotenv
ATTACHMENT_STORAGE_DRIVER=oss
ATTACHMENT_OSS_BUCKET=cloudcrane-attachments-prod
ATTACHMENT_OSS_REGION=oss-cn-<region>
ATTACHMENT_OSS_ENDPOINT=https://oss-cn-<region>.aliyuncs.com
ATTACHMENT_OSS_INTERNAL=false
ATTACHMENT_OSS_ACCESS_KEY_ID=<RAM user or STS access key>
ATTACHMENT_OSS_ACCESS_KEY_SECRET=<secret>
# 使用 STS 临时凭证时填写；长期 RAM AK 不建议直接用于生产。
ATTACHMENT_OSS_STS_TOKEN=
ATTACHMENT_OSS_TIMEOUT_MS=60000
```

生产环境必须先创建 Bucket，再配置地域、私有读写权限和生命周期规则（建议 `attachments/` 前缀超过 7 天自动删除）。RAM 身份只授予该 Bucket 下 `PutObject`、`GetObject`、`DeleteObject`，禁止使用主账号 AccessKey；密钥只放在服务器私有环境文件中，不写入仓库、日志或浏览器。当前实现支持长期 RAM AK 和 STS Token，后续可在不改附件协议的前提下增加自动 AssumeRole。

未配置 `ATTACHMENT_STORAGE_ROOT` 时，开发环境使用 `AGENT_DATA_ROOT/attachments`。生产 ECS 应显式配置绝对路径，并确保运行用户拥有该目录的 `0700` 目录和 `0600` 文件权限；该目录不能位于公开站点根目录或 Workspace 网站目录。

浏览器先通过 multipart 上传附件，再通过 `agent.prompt` 发送附件元数据引用。Agent Service 每次读取都会重新校验附件属于当前 Website 和 Session；未来切换阿里云 OSS 时，只替换 `AttachmentStorage` 适配器，不改变 WebSocket 协议和数据库元数据。

PDF、DOCX、XLSX、SVG、HTML、脚本和可执行文件暂不支持。需要扩展时必须先增加独立解析器、资源限制和安全测试，不能把原文件直接交给 Pi 或 Workspace。
