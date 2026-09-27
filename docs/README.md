# 文档索引

文档按用途归档。架构基线说明已经确认的系统边界；实现与基线有冲突时，应先记录差异并确认，不要仅为追随当前代码而静默改写基线。

## 目录

- [architecture/](architecture/)：产品技术方案、Tech-01 至 Tech-07 架构基线，以及认证、计费、观测、模板快照、附件等专题设计。
- [operations/](operations/)：本地远程开发、部署、Preview 和生产环境操作手册。
- [product/](product/)：产品定义与模板广场产品说明。
- [testing/](testing/)：E2E 测试账号说明。账号密码等本地信息保存在被 Git 忽略的 `.local.md` 文件中。

## 建议阅读顺序

1. 从 [产品定义](product/website-coding-agent-product-definition-v0.1.md) 了解产品范围。
2. 阅读 [实施基线](architecture/website-coding-agent-tech-07-implementation-baseline-mvp.md) 和它引用的 Tech-01 至 Tech-06 文档。
3. 按开发、部署或验收需要查阅相应目录中的专题文档。

架构工作应以仓库当前确认的 Tech-01 至 Tech-07 文档为基线；运维手册描述的服务器状态和凭据需要在实际操作前重新核实。
