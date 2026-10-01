# 文档索引

文档按用途归档。架构基线说明已经确认的系统边界；实现与基线有冲突时，应先记录差异并确认，不要仅为追随当前代码而静默改写基线。

## 目录

- [architecture/](architecture/)：产品技术方案、Tech-01 至 Tech-07 架构基线，以及认证、计费、观测、模板快照、附件等专题设计。
- [operations/](operations/)：本地远程开发、部署、Preview 和生产环境操作手册。
- [product/](product/)：产品定义与模板广场产品说明。
- [testing/](testing/)：E2E 测试登录说明。请阅读[凭据查找与使用规则](testing/cloudcrane-e2e-test-account.md)；本机凭据只保存在 Git 忽略文件 `docs/testing/cloudcrane-e2e-test-account.local.md` 中，不提交到仓库。

## 建议阅读顺序

1. 从 [产品定义](product/website-coding-agent-product-definition-v0.1.md) 了解产品范围。
2. 阅读 [实施基线](architecture/website-coding-agent-tech-07-implementation-baseline-mvp.md) 和它引用的 Tech-01 至 Tech-06 文档。
3. 按开发、部署或验收需要查阅相应目录中的专题文档。

日常修改、Git 提交/推送、CI 与生产发布状态从[工程生命周期说明](operations/cloudcrane-development-lifecycle.md)开始。该文档同时标出当前已实现流程与尚未配置的自动部署目标。

架构工作应以仓库当前确认的 Tech-01 至 Tech-07 文档为基线；运维手册描述的服务器状态和凭据需要在实际操作前重新核实。
