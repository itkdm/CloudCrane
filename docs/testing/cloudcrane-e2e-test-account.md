# CloudCrane E2E 测试凭据

此文件仅说明凭据存放约定，不是账号可用性或远程环境健康状态的证明。凭据只允许保存在本地被 Git 忽略的 `cloudcrane-e2e-test-account.local.md` 文件中；不要把账号标识、密码、Cookie、Token 或认证流程数据写入此跟踪文件、日志或提交。

执行 CloudCrane 用户流程 E2E 前，按仓库 `AGENTS.md` 使用 ECS 完整服务栈及 DEVTOOLS MCP；确认目标环境与授权后再从本地凭据文件读取账号。不要使用裸启动的本地 Web 端口替代默认验收链路。凭据文件当前是否存在以及是否被 Git 忽略应在操作前检查，不需要打开或输出其内容。
