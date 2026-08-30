# CloudCrane（筑云鹤）技术架构基线 06：Context、AGENTS.md 与 Skills

> 文档版本：V0.1  
> 状态：已确认 / Architecture Baseline  
> 更新时间：2026-08-30
>
> 前置文档：
> - `website-coding-agent-product-definition-v0.1.md`
> - `website-coding-agent-tech-01-workspace.md`
> - `website-coding-agent-tech-02-remote-execution-gateway.md`
> - `website-coding-agent-tech-03-preview-production-release-persistence.md`
> - `website-coding-agent-tech-04-agent-runtime-pi.md`
> - `website-coding-agent-tech-05-remote-tools-client-preview.md`
>
> 本文继续遵循：
>
> **Pi-first：Pi 已经稳定提供并符合产品语义的能力，优先直接复用，不重新设计一套等价机制。**

---

# 1. 本文解决的问题

Website Agent 不仅需要“会调用 Tool”，还需要长期理解：

```text
平台规则
当前 Website 的长期约束
当前 CMS 的知识
设计要求
SEO / 安全 / 前端等专业工作流
用户自定义工作流
某些网站功能集成方案
```

本文冻结：

1. System Prompt、AGENTS.md、Skill 三者边界；
2. 是否自定义 Skill 标准；
3. Skill 如何存放；
4. 官方 Skill、用户 Skill、网站定制 Skill 如何处理；
5. “网站插件 Skill”到底是什么；
6. Skill 如何跟随 Website Workspace；
7. Pi 如何发现和按需加载 Skill；
8. Skill 与远程 Workspace 的关系；
9. Skill 的安全边界；
10. V1 明确不设计哪些额外系统。

---

# 2. 最终结论

V1 采用：

> **System Prompt + AGENTS.md + Pi / Agent Skills**

不重新设计：

```text
Website Skill Protocol
Website Plugin Skill Protocol
Skill Category System
Skill Runtime
Skill Marketplace Runtime
```

整体：

```text
System Prompt
    │
    ├── 平台永远成立的规则
    │
    ↓
AGENTS.md
    │
    ├── 当前 Website 长期成立的项目规则
    │
    ↓
Skills
    │
    ├── 特定任务发生时按需加载的专业能力
    │
    ↓
Pi Agent
```

---

# 3. Context 三层模型

## 3.1 System Prompt

负责：

> Website Agent 平台级、永远成立的规则。

例如：

```text
Agent 操作的是 Website Workspace
必须通过 Tool 操作真实文件
Workspace 与 Production 分离
UI 修改后应进行 Preview 验证
Publish 必须走正式 Release Pipeline
不得绕过 Workspace Gateway
不得访问其他 Website
不得把 Agent Service Host 当作 Website Source
```

这些规则：

```text
不是某个网站自己的
不是某类任务才需要
```

因此属于：

> System Prompt。

---

## 3.2 AGENTS.md

负责：

> 当前 Website 长期成立的项目规则和项目知识。

例如：

```text
品牌名称固定写法
Logo 不允许修改
主色
按钮风格
目录约定
某些模板文件不可修改
当前网站特殊技术约束
代码约定
长期业务规则
```

这些规则：

```text
属于这个 Website
长期成立
通常每个 Agent Run 都应该知道
```

因此属于：

> AGENTS.md。

---

## 3.3 Skills

负责：

> 某类任务发生时才需要加载的知识、工作流、代码、参考资料和辅助脚本。

例如：

```text
SEO
前端设计
网站安全检查
PbootCMS 特定操作
多语言功能集成
客服功能集成
表单功能集成
某种页面设计规范
用户自己定义的工作流
```

这些内容不应该永远完整进入 Context。

因此使用：

> Pi Skill progressive disclosure。

---

# 4. 不自定义 Skill 标准

正式确定：

> **Website Agent 直接兼容 Pi / Agent Skills 格式。**

不发明：

```text
bujidao-skill.yaml
website-skill.json
plugin-skill
cms-skill
seo-skill
```

等私有协议。

Skill 继续使用标准：

```text
SKILL.md
```

例如：

```text
my-skill/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

---

# 5. Skill 不做业务分类系统

第一版不增加：

```text
category = SEO
category = FRONTEND
category = CMS
category = PLUGIN
category = SECURITY
```

Pi 本身没有要求这类业务分类。

因此 Runtime 层统一认为：

```text
Skill = Skill
```

Skill 是：

```text
SEO
前端
PbootCMS
多语言
表单
客服
用户自定义
```

都没有区别。

目录可以为了人类管理进行组织，但：

> 目录结构不是 Runtime 分类系统。

---

# 6. 推荐 Website Workspace 结构

新 Website 初始化时：

```text
/workspace
├── AGENTS.md
│
├── .agents/
│   └── skills/
│       ├── pbootcms/
│       │   └── SKILL.md
│       │
│       ├── frontend-design/
│       │   └── SKILL.md
│       │
│       ├── seo/
│       │   └── SKILL.md
│       │
│       └── custom-feature/
│           ├── SKILL.md
│           ├── references/
│           ├── scripts/
│           └── assets/
│
├── apps/
├── config/
├── core/
├── template/
├── static/
└── ...
```

默认优先采用：

```text
.agents/skills/
```

而不是产品自己定义目录。

原因：

```text
Pi 原生支持
更中性
不把 Website 项目强绑定到 Pi 品牌
与 Agent Skills 生态更容易兼容
```

---

# 7. 其他 Agent 的 Skill 目录

如果未来需要兼容：

```text
.codex/skills/
.claude/skills/
.pi/skills/
```

优先使用 Pi 已有的：

```text
skills paths
ResourceLoader
```

进行接入。

不要求所有 Skill 强制迁移到同一个目录。

V1 默认初始化：

```text
.agents/skills/
```

即可。

---

# 8. 官方 Skill 的处理方式

平台以后可能提供：

```text
PbootCMS Skill
Frontend Design Skill
SEO Skill
Security Skill
```

这些不是：

> 中央只读 Skill Service。

V1 更简单：

```text
创建 Website
↓
初始化 Workspace
↓
把需要的官方 Skill 复制到 .agents/skills/
```

复制以后：

> Skill 就属于这个 Website。

用户可以：

```text
查看
修改
删除
扩展
Git Commit
备份
迁移
```

---

# 9. 用户可以直接定制官方 Skill

例如：

```text
.agents/skills/frontend-design/SKILL.md
```

默认是平台版本。

用户可以说：

> 以后这个网站所有页面都更偏极简风，不要渐变。

Agent 可以直接：

```text
read SKILL.md
↓
edit SKILL.md
↓
保存
```

以后该 Website 使用的就是定制后的 Skill。

不额外创建：

```text
OfficialSkillOverride
SkillPatch
UserSkillConfig
```

这类系统。

---

# 10. 用户自己创建 Skill

用户可以直接创建：

```text
.agents/skills/product-page-design/
└── SKILL.md
```

也可以：

```text
复制一个现有 Skill
修改 Skill
让 Agent 帮忙创建 Skill
```

这些全部是普通项目文件。

不需要平台数据库单独保存 Skill 正文。

---

# 11. 网站“插件”在这里不是 Agent Plugin

必须明确：

本文中的：

```text
多语言插件
客服插件
表单插件
```

指的是：

> 网站代码能力 / 网站功能方案。

不是：

```text
Agent Plugin
Agent Extension
Platform Plugin
```

---

# 12. 网站插件 Skill 的本质

所谓：

```text
多语言插件 Skill
```

本质是：

> 一份指导 Coding Agent 如何把多语言功能集成到当前 Website 的 Skill。

例如：

```text
multilingual/
├── SKILL.md
├── references/
│   └── integration.md
├── assets/
│   └── language-switcher.html
└── scripts/
    └── migrate.php
```

Skill 可以包含：

```text
远程文档链接
集成步骤
代码片段
完整代码模板
assets
helper scripts
验证步骤
注意事项
```

---

# 13. 不设计 Website Plugin Manager

正式不引入：

```text
plugin_install
plugin_uninstall
Plugin Catalog
Plugin Runtime
Plugin Manager
Installed Plugin State
```

用户使用某个网站功能 Skill：

```text
加载 Skill
↓
Agent 阅读代码与文档
↓
read Website
↓
edit / write / bash
↓
把功能真正集成进 Website Source
↓
Preview
↓
Verify
```

这就是“安装网站插件”的真实过程。

---

# 14. Skill 可以按需暴露

Skill 是否对模型默认可见：

> 后续产品阶段再决定。

V1 不重新设计一套复杂开关协议。

优先保留 Pi 原生机制：

```text
普通 Skill
→ name + description 可被模型发现

disable-model-invocation: true
→ 不进入默认模型 Skill 列表
→ 用户显式调用
```

未来如果做：

```text
Skill Enable / Disable UI
```

本质也只是决定：

```text
哪些 Skill Path
哪些 Skill
```

交给 Pi。

---

# 15. 不提前设计 Skill 管理产品

V1 架构只保留 Skill 能力。

暂不设计：

```text
Skill Marketplace
Skill Rating
Skill Review
Skill Search
Skill Version Center
Skill Category
Skill Publish Workflow
Skill Revenue
Skill Dependency Resolver
```

这些全部属于以后产品问题。

---

# 16. Pi Progressive Disclosure 直接复用

Skill 不应该把完整内容永远塞进 System Prompt。

继续使用 Pi：

```text
Startup
↓
扫描 Skill
↓
只注入 name + description + location
↓
任务匹配
↓
Agent read SKILL.md
↓
读取完整 Skill
```

这样：

```text
100 个 Skill
```

不会把 100 个完整 Skill 内容都放入 Context。

---

# 17. Skill references / scripts / assets 全部保留

因为 Skill 是普通目录：

```text
skill/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

Agent 可以：

```text
read references
read assets
bash scripts
复制 assets 到 Website
修改示例代码
```

不把 Skill 简化成：

```text
数据库里一段 Prompt
```

---

# 18. Skill 与 Website Workspace 共存

Skill 本身直接位于：

```text
Website Workspace
```

因此天然跟随：

```text
Git
Workspace Backup
OSS Backup
Website Snapshot
迁移
恢复
```

不建立独立 Skill 存储真源。

---

# 19. Skill 可以进入 Git

默认：

```text
AGENTS.md
.agents/skills/**
```

都属于项目文件。

可以：

```text
git diff
git commit
git restore
```

这意味着：

> Website 的 Agent Knowledge 也属于项目版本的一部分。

这对于长期维护非常重要。

---

# 20. Skill 与 Source of Truth

```text
Website Source
AGENTS.md
Skills
```

都在同一个 Website Workspace。

因此当前 Website 的：

```text
代码
长期 Agent 规则
按需 Agent 能力
```

可以一起迁移。

---

# 21. Pi ResourceLoader 的现实问题

Pi 当前 ResourceLoader 默认读取：

> Agent Runtime 所在机器的本地文件系统。

而我们的 Agent Service 与 Website Workspace 逻辑上是分离的：

```text
Agent Service
↓
Workspace Gateway
↓
Workspace
```

因此：

```text
Pi ResourceLoader
```

必须能够看到：

```text
Workspace/.agents/skills
Workspace/AGENTS.md
```

---

# 22. V1 单 ECS 的简单实现

V1 本身是：

```text
同一 ECS
+
Persistent Workspace Directory
+
Workspace Container
+
Agent Service
```

因此完全可以：

```text
/site-data/{websiteId}/workspace/
```

作为宿主持久目录。

Workspace Container：

```text
/site-data/{websiteId}/workspace/
→ /workspace
```

Agent Service：

```text
读取同一份持久目录中的：
AGENTS.md
.agents/skills/**
```

这样：

```text
Workspace
和
Pi ResourceLoader
```

看到的是：

> 同一份物理文件。

没有 Skill 同步问题。

---

# 23. Agent Service 不因此获得任意 Website 执行能力

即使 Agent Service 可以读取：

```text
AGENTS.md
Skill Resource
```

真正的网站：

```text
文件修改
命令执行
```

仍然通过：

```text
Pi Remote Tools
↓
Workspace Gateway
```

进行。

ResourceLoader 的本地读取只是：

> Agent Context Resource 加载。

不能绕过 Tool Execution Security。

---

# 24. 未来远程 Sandbox

未来如果切换到：

```text
ACS Agent Sandbox
Remote Workspace
MicroVM
```

Agent Service 可能无法直接访问 Workspace Persistent Directory。

此时增加一个很薄的：

```text
ProjectResourceProvider
```

即可。

例如：

```text
ProjectResourceProvider

getAgentsFiles()
getSkillPaths()
materializeResources()
```

V1：

```text
LocalWorkspaceProjectResourceProvider
```

未来：

```text
RemoteSandboxProjectResourceProvider
```

---

# 25. ProjectResourceProvider 不是新的 Skill Framework

必须避免过度设计。

它只解决：

> Pi ResourceLoader 如何“看见”当前 Website 的项目资源。

不负责：

```text
解析 Skill
Skill 分类
Skill 版本
Skill 调用
Skill progressive disclosure
```

这些全部继续交给 Pi。

---

# 26. Skill 脚本执行

如果 Skill 有：

```text
scripts/
```

Agent 需要执行：

```text
bash .agents/skills/foo/scripts/check.sh
```

仍然使用：

```text
Pi bash
↓
RemoteBashOperations
↓
Workspace Gateway
↓
Workspace Sandbox
```

脚本不会因为属于 Skill，就在：

```text
Agent Service Host
```

执行。

---

# 27. Skill 安全边界

Pi 官方也明确提醒：

> Skill 可能包含可执行代码，也可以指示 Agent 执行高风险操作。

因此：

```text
Skill
```

永远只是：

> Instructions / Resources。

真正权限仍然由：

```text
Tool Policy
Workspace Gateway
Workspace Isolation
Production Policy
```

控制。

---

# 28. Skill 不能扩大权限

即使 Skill 写：

```text
读取其他用户网站
访问 Docker Socket
获取 ECS Credential
直接覆盖 Production DB
```

也不能成功。

因为：

```text
Skill
↓
Agent
↓
Tool
↓
Policy / Gateway
```

权限边界不由 Skill 决定。

---

# 29. Skill allowed-tools 不作为安全真源

如果 Agent Skills / Pi 支持：

```text
allowed-tools
```

可以作为：

> Agent 使用提示 / convenience。

但不能作为：

> Platform Security Boundary。

最终 Tool 权限仍由 Website Agent 自己的 Tool Policy 控制。

---

# 30. Skill Reload

第一版不追求复杂实时热更新。

用户修改：

```text
SKILL.md
```

后：

```text
下一个 Agent Run
或
ResourceLoader reload
```

生效即可。

如果 Pi 当前可以在 Session Runtime 中自然 reload，则直接复用。

不重新设计 Hot Reload Protocol。

---

# 31. AGENTS.md 与 Skill 的边界示例

## 情况 A

要求：

> Logo 永远不要修改。

应该放：

```text
AGENTS.md
```

因为每个任务都应该知道。

---

## 情况 B

要求：

> 做 SEO 时检查 canonical、title、structured data。

应该放：

```text
seo/SKILL.md
```

因为只有 SEO 任务需要。

---

## 情况 C

要求：

> 这个网站的产品页面统一使用某套视觉风格。

如果长期所有 Agent Run 都应该遵守：

```text
AGENTS.md
```

如果只在“设计产品页面”任务发生时需要一整套详细工作流：

```text
product-page-design/SKILL.md
```

两者可以配合。

---

# 32. System Prompt 与 Skill 不重复

System Prompt 不应该包含：

```text
完整 SEO 教程
完整 PbootCMS 文档
完整前端设计指南
```

否则 Context 长期膨胀。

System Prompt 只写：

```text
平台边界
安全
执行原则
验证原则
```

专业知识下沉到 Skill。

---

# 33. AGENTS.md 不变成知识垃圾桶

AGENTS.md 也不应该无限堆：

```text
SEO
PbootCMS API 全文
设计教程
插件文档
```

否则每次 Agent Run 都被迫携带。

AGENTS.md 只保留：

> 当前 Website 长期有效并且高频需要遵守的信息。

---

# 34. 推荐 Context 构建

一次 Agent Run：

```text
Pi Base Coding Prompt
+
Website System Prompt
+
Website AGENTS.md
+
Available Skill Metadata
+
Pi Session Context
+
Current Website State
+
User Prompt
```

如果需要 Skill：

```text
Agent
↓
read SKILL.md
↓
Skill Full Instructions
```

---

# 35. Current Website State 不写死到 AGENTS.md

像：

```text
current git HEAD
git status
latest release
preview status
current changed files
```

这些是动态状态。

应该由：

```text
WebsiteAgentRuntime
```

动态注入。

不要持续写入：

```text
AGENTS.md
```

---

# 36. Skill 不等于 Memory

Skill 是：

> 可复用工作流 / 专业能力。

例如：

```text
怎么做 SEO
怎么集成表单
怎么做前端视觉检查
```

而：

```text
用户上次决定 Logo 不能改
当前网站是什么业务
```

属于：

```text
AGENTS.md
Website Context
Session History
```

不把所有“记忆”做成 Skill。

---

# 37. Skill 来源 V1 不需要复杂建模

V1 可以存在：

```text
平台初始化复制的
用户自己创建的
用户自己复制进来的
Agent 创建的
```

但进入项目后：

```text
都是 Website Workspace Skill
```

Runtime 不需要追踪：

```text
official
user
plugin
external
```

来源标签。

以后产品有真实需求再增加 metadata。

---

# 38. Skill 名称冲突

第一版：

> 直接沿用 Pi 的 Skill collision 行为和 diagnostics。

不设计：

```text
priority
namespace
override graph
```

如果出现冲突：

```text
提示用户
调整 Skill name
```

即可。

---

# 39. Skill 版本

第一版不建立：

```text
skill_version table
```

Skill 的当前版本就是：

```text
Workspace 当前文件内容
+
Git History
```

已经足够。

---

# 40. 官方 Skill 更新

如果平台以后发布新版官方 Skill：

第一版不自动覆盖用户已经修改的 Skill。

因为：

```text
Website Skill
=
用户项目文件
```

未来可以做：

```text
比较官方新版
↓
提示 diff
↓
用户/Agent 手动合并
```

但当前不设计自动升级。

---

# 41. Skill 删除

用户删除：

```text
.agents/skills/foo/
```

就等于：

> 当前 Website 不再拥有这个 Skill。

不需要同步删除平台数据库状态。

---

# 42. Skill 与 Website Snapshot

Website Snapshot 后续可以自然包含：

```text
Code Commit
AGENTS.md
Skills
DB Backup
Uploads
Release
```

因此恢复 Website 时：

> Agent Knowledge 也可以一起恢复。

---

# 43. V1 推荐目录

最终建议：

```text
/workspace
├── AGENTS.md
├── .agents/
│   └── skills/
│       └── ...
├── apps/
├── config/
├── core/
├── data/
├── rewrite/
├── static/
├── template/
└── ...
```

只有：

```text
AGENTS.md
.agents/skills/
```

是 Website Agent 额外推荐的项目资源结构。

---

# 44. 不要求用户理解 Agent Skills 技术细节

UI 可以以后显示：

```text
Skills
```

用户可以：

```text
查看
新增
编辑
删除
开启/关闭
```

但底层仍然只是：

```text
Workspace Files
+
Pi ResourceLoader
```

产品 UI 不改变底层标准。

---

# 45. V1 明确不做

第一版不做：

```text
私有 Skill 标准
Skill 业务分类系统
PluginSkill 类型
CMS Skill 类型
Skill Marketplace
Plugin Manager
Plugin Install API
中央 Skill Source of Truth
Skill 数据库正文存储
Skill 复杂依赖系统
Skill 自动版本升级
Skill 自动覆盖用户修改
Skill 独立权限系统
Skill 独立执行 Runtime
Skill 独立 Sandbox
```

---

# 46. Architecture Decisions

## ADR-094

Website Agent Context 采用 System Prompt + AGENTS.md + Skills 三层模型。

## ADR-095

System Prompt 只承载平台级永远成立的 Agent 规则。

## ADR-096

AGENTS.md 承载当前 Website 长期成立的项目规则和长期约束。

## ADR-097

特定任务所需专业知识和工作流使用 Skill，按需加载。

## ADR-098

V1 直接兼容 Pi / Agent Skills 格式，不建立私有 Skill 协议。

## ADR-099

V1 不建立 Skill 业务分类系统。

## ADR-100

Website Workspace 默认使用 `.agents/skills/` 存放项目 Skill。

## ADR-101

平台官方 Skill 在 Website 初始化或用户选择时复制进 Website Workspace，之后属于 Website 项目文件。

## ADR-102

用户可以直接修改、删除、复制和创建 Website Skill。

## ADR-103

“网站插件 Skill”只是普通 Skill，描述如何通过 Coding Agent 把某项网站功能集成进当前 Website，不建立 Website Plugin Manager。

## ADR-104

Pi 原生 Skill progressive disclosure、显式 Skill 调用和相关能力优先直接复用。

## ADR-105

Skill、AGENTS.md 与 Website Source 一起进入 Git、Backup、Snapshot 和迁移流程。

## ADR-106

V1 单 ECS 下 Pi ResourceLoader 直接读取 Website Persistent Workspace 中的 AGENTS.md 和 `.agents/skills/`。

## ADR-107

未来远程 Sandbox 场景只通过薄 `ProjectResourceProvider` 解决资源可见性，不重新实现 Skill Framework。

## ADR-108

Skill 中的 scripts 必须通过 Remote Bash 在 Workspace Sandbox 内执行，不在 Agent Service Host 执行。

## ADR-109

Skill 无权突破 Website Tool Policy、Workspace Gateway 和 Production Security Boundary。

## ADR-110

V1 Skill 更新使用文件修改 + Resource reload / next Agent Run 生效，不设计复杂热更新系统。

## ADR-111

V1 不对官方 Skill 自动升级覆盖用户已经定制的 Skill。

---

# 47. 最终 Context 架构

```text
                         Pi Agent
                            │
             ┌──────────────┼───────────────┐
             │              │               │
       System Prompt     AGENTS.md        Skills
             │              │               │
      Platform Rules    Website Rules    On-demand
             │              │          Capabilities
             │              │               │
             └──────────────┼───────────────┘
                            ↓
                     Agent Context
                            │
                            ↓
                        Pi Session
                            │
                            ↓
                     Coding Agent Loop
```

Website Workspace：

```text
/workspace
├── AGENTS.md
├── .agents/
│   └── skills/
│       ├── pbootcms/
│       │   └── SKILL.md
│       ├── frontend-design/
│       │   └── SKILL.md
│       ├── seo/
│       │   └── SKILL.md
│       └── ...
└── Website Source
```

---

# 48. 一句话总结

> **Website Agent 不建设新的 Skill 平台协议，而是把 Website Workspace 本身做成一个标准 Coding Agent 项目：System Prompt 管平台边界，AGENTS.md 管网站长期规则，`.agents/skills/` 管按需能力；Pi 能直接发现、加载和使用的机制全部直接复用。**
