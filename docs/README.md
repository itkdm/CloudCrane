# 文档索引

文档按用途归档。Tech-01 至 Tech-07 保留架构决策和设计时背景，不一定描述当前所有实现细节；当前实现状态以工程生命周期说明和专题文档中最新的“当前状态”小节为准。若代码与仍有效的架构决策冲突，应记录差异并确认，不能把历史方案段落误读为已实现能力。

## 目录

- [architecture/](architecture/)：产品技术方案、Tech-01 至 Tech-07 架构基线，以及认证、计费、观测、模板快照、附件等专题设计。
- [operations/](operations/)：本地远程开发、部署、Preview 和生产环境操作手册。
- [product/](product/)：产品定义与模板广场产品说明。
- [testing/](testing/)：E2E 测试登录说明。请阅读[凭据查找与使用规则](testing/cloudcrane-e2e-test-account.md)；本机凭据只保存在 Git 忽略文件 `docs/testing/cloudcrane-e2e-test-account.local.md` 中，不提交到仓库。

## 建议阅读顺序

1. 从 [产品定义](product/website-coding-agent-product-definition-v0.1.md) 了解产品范围。
2. 阅读 [实施基线](architecture/website-coding-agent-tech-07-implementation-baseline-mvp.md) 和它引用的 Tech-01 至 Tech-06 文档。
3. 按开发、部署或验收需要查阅相应目录中的专题文档。

日常开发、Git 提交/推送、CI/CD、发布与当前实现证据从[工程生命周期说明](operations/cloudcrane-development-lifecycle.md)开始。平台 CD 已配置；Website Production 发布指 CloudCrane 托管网站的产品功能，两者是不同流程。

架构工作应参考 Tech-01 至 Tech-07 的有效决策，并核对最新实现状态；运维手册中的服务器、DNS、证书和服务状态会变化，执行操作前须按实际环境复核。产品提案只表达范围与方向，不作为当前功能清单。
