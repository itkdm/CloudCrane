# CloudCrane 认证上线配置

本文记录邮箱验证、密码找回和 Google 登录上线前需要准备的外部配置。

## 先说明：打开 Gmail 还不等于配置完成

Gmail 收件箱只能用于接收测试邮件。当前项目的认证邮件由 Resend API 发送，Google 登录由 Google Cloud OAuth 客户端提供，因此还需要分别配置：

- Resend 的 API Key 和已验证的发件人地址；
- Google Cloud 的 OAuth Web Client ID 和 Client Secret。

这些值都是私密配置，不能提交到 Git，也不要粘贴到聊天记录或日志中。

## Resend（邮箱验证和密码找回）

1. 在 Resend 创建账号并验证发信域名。没有域名时，也可以先使用 Resend 控制台允许的已验证测试发件人做联调。
2. 创建 API Key。
3. 在本地 `D:/develop/project/pbootcmsAgent/.env.private.local` 写入：

```dotenv
AUTH_EMAIL_FROM=CloudCrane <noreply@your-domain.example>
RESEND_API_KEY=仅写入本地私密文件的真实值
AUTH_REQUIRE_EMAIL_VERIFICATION=true
NEXT_PUBLIC_AUTH_REQUIRE_EMAIL_VERIFICATION=true
```

4. 通过 SSH 将同一份私密配置安全复制到新加坡服务器 `/opt/cloudcrane/.env.private.local`。该文件不受 Git 管理。

> `AUTH_EMAIL_FROM` 的域名必须是 Resend 已验证的域名，否则邮件发送会失败。Gmail 地址可以作为收件人，但不应直接把个人 Gmail 密码放进服务器；项目当前也没有使用 Gmail SMTP。

## Google 登录

在 Google Cloud Console 创建 OAuth Client ID，类型选择 Web application，并添加对应环境的授权重定向地址：

```text
http://localhost:3000/api/auth/callback/google
https://你的生产域名/api/auth/callback/google
```

当前 Better Auth 默认使用 `/api/auth/callback/google`；回调地址的域名必须与 `BETTER_AUTH_URL` 完全一致。分别把凭据写入本地和服务器私密环境：

```dotenv
GOOGLE_CLIENT_ID=仅写入本地私密文件的真实值
GOOGLE_CLIENT_SECRET=仅写入本地私密文件的真实值
BETTER_AUTH_URL=http://localhost:3000
```

通过 SSH 隧道联调时，浏览器访问的是 `http://localhost:3000`，所以本地测试只能使用上面的 localhost 回调。正式域名启用后，再在 Google Cloud Console 添加正式 HTTPS 回调，并同步修改服务器的 `BETTER_AUTH_URL`。

## 新加坡服务器部署检查

部署前确认 `/opt/cloudcrane/.env.private.local` 至少包含以下已脱敏配置项；检查时只查看变量名，不要输出值：

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
AUTH_EMAIL_FROM
RESEND_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
AUTH_REQUIRE_EMAIL_VERIFICATION
NEXT_PUBLIC_AUTH_REQUIRE_EMAIL_VERIFICATION
```

修改私密环境后，在服务器重新构建并重启 Web 服务，使 Next.js 服务端读取新配置。随后通过 `http://localhost:3000` 做真实验收：

- 注册新账号并收到验证邮件；
- 点击验证链接后登录；
- 申请密码重置并收到邮件；
- 使用 Google 登录并正确回调；
- 确认普通用户只能访问自己的 Website。

当前隧道联调必须保持以下来源一致，否则 Cookie 和 Agent CORS 会出现问题：

```dotenv
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_AGENT_SERVICE_URL=http://localhost:4101
```

在 Resend 和 Google OAuth 凭据补齐前，邮箱验证、密码找回和 Google 登录只能完成页面与错误路径检查，不能声称真实邮件或 OAuth 流程已通过。

