# E2E with DEVTOOLS MCP

DEVTOOLS MCP 是开发验收工具，不是 CloudCrane 运行时架构的一部分。所有 UI、用户流程、Chat、Preview、Workspace 创建、Agent 交互、刷新和重连验收，都必须连接真实开发服务并使用 DEVTOOLS MCP。

验收要求：打开真实 URL，从 UI 操作而非 curl；检查 DOM、可见文本和状态；确认 Console 没有未解释错误；确认 Network 没有意外 4xx/5xx；保存关键截图；刷新、重新打开或重连后验证状态持久化；实际走一次错误路径并确认用户可见反馈。

如果工具不可用，准确报告：`E2E blocked: DEVTOOLS MCP unavailable`。不得用其他浏览器、curl 或接口脚本替代并声称完成 DEVTOOLS MCP E2E。
