# Architecture Reference

## Shape

CloudCrane 使用“Deployable Apps + Capability Packages + light Ports/Adapters”：Apps 是可部署进程和组合根，Packages 是可复用能力、协议、客户端或适配器。Packages 不得依赖 Apps。只有在出现真实业务逻辑后才按 Transport → Application → Infrastructure/Adapter → External Resource 分层；不要为占位代码机械创建空层。

## Package responsibilities

- `agent-service`: Agent 会话编排、流式事件、鉴权和运行状态。
- `website-agent`: 面向网站的 Agent 能力编排，不拥有 Web 传输或 Docker 控制。
- `pi-adapter`: Pi AgentSession/Tool 的适配，不直接访问 Docker/ECS 文件系统。
- `workspace-client`: Workspace 能力的客户端边界，不依赖 Pi。
- `workspace-protocol`: Gateway、Runner、Client 间稳定协议；不依赖 DB 或 Pi。
- `workspace-gateway`: Workspace 控制面入口与策略/路由。
- `runner`: 执行 provider/daemon 的运行时边界，不依赖 Pi。
- `shared`: 低层横切能力，不承载业务包依赖。
- `db`: 服务端持久化访问；不得成为前端或运行时边界的隐式通道。

依赖图：

```text
agent-service → website-agent → pi-adapter → workspace-client → workspace-protocol
workspace-gateway → workspace-protocol
runner → workspace-protocol
```

禁止 Packages → Apps、Web → Runner/Docker、Agent Service → Docker、Pi Adapter → Docker/ECS 文件系统、Workspace Client → Pi、Protocol → DB/Pi、Runner → Pi、Shared → 业务包、React → PostgreSQL。

## Data flow and truth ownership

- Agent：Browser → WebSocket → agent-service → website-agent → pi-adapter → Pi AgentSession → Pi Tool → workspace-client → gateway → runner → provider → daemon → Workspace；结果和事件反向返回。
- CRUD：Browser → Next Server API/BFF → use case → DB → PostgreSQL。
- 生命周期：use case → workspace-client → gateway → runner → provider → Docker/未来 ACS。
- Preview：Workspace runtime → URL → user client；观察通过 Preview Bridge → user client → Agent Service WebSocket → Pi，不在服务器隐藏启动浏览器。

Pi session 是对话真相，Workspace 是代码真相，Production DB 是内容真相，Platform PostgreSQL 是控制元数据真相。
