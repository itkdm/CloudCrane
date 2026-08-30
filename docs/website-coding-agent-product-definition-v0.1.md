# CloudCrane（筑云鹤）产品定义（V0.1）

> 当前阶段：产品形态冻结版  
> 首个 CMS：PbootCMS  
> 产品方向：To C，自助式企业官网 Website Coding Agent  
> 项目品牌：CloudCrane（筑云鹤）  
> 文档目标：明确产品是什么、第一版做什么、怎么使用、后续怎么演进，以及哪些能力需要提前在架构上预留。

---

## 1. 产品一句话定义

**Website Coding Agent 是一个面向普通个人与企业用户的自助式官网开发与长期维护平台。**

每创建一个网站，平台就为该网站分配一个长期存在的独立 Workspace。Workspace 内拥有真实的网站代码、CMS、数据库、运行环境、Git 历史和 Agent 可操作能力。

用户通过自然语言与 Agent 交互，Agent 像 Coding Agent 一样直接读取、搜索、修改、运行、验证网站工程，并最终完成预览、发布和后续维护。

第一版以 **PbootCMS** 作为网站 Runtime，后续可扩展到 WordPress 等其他 CMS。

---

## 2. 产品不是什么

本产品不是：

- 一个单纯的“AI 生成 HTML 页面”工具；
- 一个 PbootCMS 后台 AI 插件；
- 一个只能生成一次、生成完就结束的网站生成器；
- 一个依赖人工建站公司交付的 To B 平台；
- 一个以拖拽式可视化编辑器为核心的传统建站 SaaS；
- 一个只负责写文章、SEO 文案的 AI 工具。

产品核心不是“一次生成网站”，而是：

> **一个网站对应一个长期存在的 Website Workspace，Agent 持续负责这个网站的开发、修改、验证和维护。**

---

## 3. 核心产品模型

### 3.1 一个网站 = 一个长期 Workspace

每个用户创建网站时，获得一个独立 Workspace。

概念上：

```text
User
  │
  └── Website Workspace
        │
        ├── CMS Runtime
        ├── Website Source Code
        ├── Database
        ├── Static Assets
        ├── Git Repository
        ├── Agent Runtime
        ├── Preview Environment
        └── Deployment State
```

Workspace 不是一次性的构建环境，而是网站的长期“工作空间”。

后续用户再次修改网站时，不需要重新上传代码、重新描述项目结构，Agent 直接进入原 Workspace 继续工作。

---

### 3.2 第一版使用 PbootCMS

第一版统一使用经过验证的 PbootCMS Base。

目标网站大致包含：

```text
target/
├── core/
├── apps/
├── config/
├── data/
├── static/
├── template/
└── ...
```

其中：

- `core/`、`apps/` 等主要属于 CMS Runtime；
- `template/` 负责前台页面结构与展示；
- `static/` 存放图片、CSS、JS、上传资源等；
- `data/` / MySQL 保存网站内容数据；
- `config/` 保存站点相关配置。

第一版不要求用户理解这些目录，Agent 负责操作。

---

### 3.3 参考模板作为 Agent 的开发参考

第一版可以允许用户选择或导入一个 **合法可使用的 PbootCMS 模板项目**。

Workspace 可以存在：

```text
workspace/
├── target/        # 最终网站
├── references/    # 参考模板 / 参考项目
├── tools/
├── knowledge/
└── workspace.yaml
```

参考项目主要用于：

- 页面结构分析；
- HTML/CSS/JS 参考；
- 动效参考；
- PbootCMS 标签使用参考；
- 布局与组件迁移；
- 响应式规则理解。

原则上：

- `target/` 是最终发布的网站；
- `references/` 默认只作为参考；
- Agent 修改目标站，而不是把参考站直接当线上站点长期维护。

后续可再支持“参考 URL → 结构理解 → 重建”，但不属于第一阶段必须验证的能力。

---

## 4. 核心交互方式

产品主交互不是传统 CMS 后台，而是 **Agent 对话 + Website Workspace**。

用户可以直接说：

> 把首页顶部改成这个模板里的样式。

> 公司名称改成 XX 科技，主色改成深蓝色。

> 新增一个产品中心页面，并把首页增加产品入口。

> 首页第二屏太挤了，重新排版。

> 手机端菜单打不开，检查一下。

Agent 工作流程：

```text
理解需求
  ↓
读取当前网站
  ↓
搜索相关文件 / 数据
  ↓
制定修改方案
  ↓
修改代码 / 内容 / 配置
  ↓
运行网站
  ↓
浏览器预览
  ↓
发现问题继续修复
  ↓
验证
  ↓
记录修改
  ↓
发布
```

这套流程更接近 Coding Agent，而不是传统网页编辑器。

---

## 5. Human UI 与 Agent Workspace 的关系

PbootCMS 后台仍然存在，但定位发生变化。

### Human UI

主要给人使用：

- 普通内容编辑；
- 文章发布；
- 产品维护；
- Banner 修改；
- 图片上传；
- 简单 SEO 信息维护；
- 日常运营。

### Agent Workspace

主要给 Agent 使用：

- 代码修改；
- 模板调整；
- CSS/JS 调试；
- 页面结构调整；
- CMS 数据初始化；
- 批量内容变更；
- SEO/GEO 工程化调整；
- 运行与测试；
- 部署；
- 故障排查；
- 后续持续维护。

最终形成：

```text
                    Website
                       │
          ┌────────────┴────────────┐
          │                         │
      Human UI                Agent Workspace
          │                         │
      CMS Admin              Code / Shell / CLI
          │                         │
          └────────────┬────────────┘
                       │
                 Website Runtime
```

Agent 不需要模拟人类在后台反复点击操作。

---

## 6. 第一版的核心目标

第一版只验证一个最重要的闭环：

> **普通用户能否通过自然语言，让 Agent 在独立 Website Workspace 中真正完成一个 PbootCMS 官网从创建、修改、预览到上线的全过程。**

第一版成功标准不是“生成了代码”，而是：

1. 创建网站 Workspace；
2. 自动准备 PbootCMS Base；
3. 导入一个可用的 PbootCMS 参考模板；
4. 用户通过对话提出修改需求；
5. Agent 可以读取和修改网站代码；
6. Agent 可以操作必要的网站数据；
7. Agent 可以运行网站；
8. Agent 可以打开浏览器检查效果；
9. Agent 可以反复修改直到可用；
10. 网站可以发布并访问；
11. Workspace 和历史状态继续保留；
12. 用户未来可以重新回来继续修改。

---

# 7. 第一版功能范围

## 7.1 Workspace 创建

用户点击“创建网站”。

系统创建一个独立 Website Workspace，并自动初始化：

- PbootCMS Base；
- PHP 运行环境；
- 数据库；
- Git；
- 网站目录；
- Agent Workspace；
- Preview 环境；
- 基础站点配置。

具体服务器、容器、远程连接方案暂不在本文确定。

---

## 7.2 网站模板导入

第一版优先支持：

- PbootCMS 模板包；
- 完整 PbootCMS 网站项目；
- 平台预置模板。

Agent可以分析：

- 首页；
- Header；
- Footer；
- 列表页；
- 内容详情页；
- 产品页；
- 新闻页；
- CSS；
- JS；
- 图片资源；
- PbootCMS 标签。

第一版不要求实现任意互联网 URL 的自动克隆。

---

## 7.3 Coding Agent

Agent 第一版拥有较高权限，可以：

- 读取文件；
- 搜索文件；
- 创建文件；
- 修改文件；
- 删除允许范围内的文件；
- 执行 Shell；
- 查看 Git Diff；
- 提交 Git；
- 操作数据库；
- 修改模板；
- 修改 CSS；
- 修改 JS；
- 修改 PHP；
- 修改 PbootCMS 配置；
- 运行网站；
- 读取运行日志；
- 调用浏览器验证页面；
- 执行部署。

第一版暂时可以视为：

> **Workspace Owner 拥有 Workspace 内全部能力。**

---

## 7.4 Preview

Agent 修改完成后，应支持实时预览。

预览至少需要：

- 可访问 Preview URL；
- 桌面端检查；
- 移动端检查；
- 页面截图；
- Console Error 检查；
- HTTP Error 检查；
- 关键页面访问检查。

后续再增加更复杂的视觉回归与自动评分。

---

## 7.5 Browser Verification

Agent 不允许“写完代码就宣布完成”。

核心工作流必须包含：

```text
Edit
 ↓
Run
 ↓
Open Browser
 ↓
Observe
 ↓
Fix
 ↓
Verify
```

至少检查：

- 页面是否正常打开；
- CSS 是否加载；
- JS 是否报错；
- 图片是否加载；
- 移动端是否严重错位；
- 关键链接是否可点击；
- PbootCMS 标签是否正常输出；
- 页面是否出现 PHP/模板错误。

---

## 7.6 Git 与修改历史

每个网站都应该天然具备版本历史。

第一版建议：

- 初始化 Git Repository；
- Agent 修改前检查工作区状态；
- 修改完成后形成 Commit；
- 能查看本次改动；
- 能回滚代码。

数据库与静态资源的完整版本化可以后续增强，但第一版至少要考虑备份。

---

## 7.7 数据操作

第一版为了快速验证，可以允许 Agent：

- 读取 SQLite / MySQL；
- 修改 CMS 数据；
- 初始化栏目；
- 初始化文章；
- 初始化产品；
- 修改网站基础配置。

但是长期不建议让 Agent 依赖“随意写 SQL”。

后续需要抽象成 CMS Capability / CLI，例如：

```text
cms.category.list
cms.category.create

cms.content.list
cms.content.create
cms.content.update

cms.media.upload

cms.site.get
cms.site.update

cms.cache.clear
cms.health.check
```

PbootCMS 可以通过自己的 Adapter 实现这些能力。

---

# 8. 第一版用户故事

## 用户故事 1：第一次创建企业官网

作为一个没有开发能力的企业负责人，

我希望输入公司基础资料并选择一个喜欢的 PbootCMS 模板，

然后告诉 Agent：

> 把这个模板改成我们公司的官网，名称、Logo、联系方式和产品都换成我们的。

Agent 自动：

1. 创建 Website Workspace；
2. 准备 PbootCMS；
3. 导入模板；
4. 理解页面；
5. 修改公司信息；
6. 修改页面内容；
7. 调整配色和品牌信息；
8. 运行网站；
9. 检查页面；
10. 给我 Preview。

用户确认后发布网站。

---

## 用户故事 2：首页二次修改

网站已经上线一个月。

用户说：

> 首页第二屏我不喜欢，把产品区域重新做一下，每行三个产品，图片大一点。

Agent：

1. 进入原 Website Workspace；
2. 找到首页模板和相关 CSS；
3. 修改布局；
4. 启动 Preview；
5. 浏览器验证桌面端和移动端；
6. 给用户查看；
7. 确认后发布。

无需重新生成整个网站。

---

## 用户故事 3：增加新的产品栏目

用户说：

> 增加“工业机器人”产品栏目，并增加三个产品，首页也增加入口。

Agent：

1. 分析当前栏目结构；
2. 创建新栏目；
3. 添加产品内容；
4. 修改首页产品区；
5. 检查产品列表和详情页；
6. 检查导航；
7. 验证；
8. 发布。

---

## 用户故事 4：修复页面问题

用户说：

> 手机打开以后顶部菜单点不开。

Agent：

1. 打开网站移动端页面；
2. 复现问题；
3. 查看 Console；
4. 搜索 Header JS/CSS；
5. 修复；
6. 再次打开浏览器；
7. 验证；
8. 提交修改。

---

## 用户故事 5：网站长期维护

半年后用户回来：

> 网站首页改成更科技一点，但产品和新闻数据全部保留。

Agent：

1. 读取当前项目；
2. 读取 Git 历史；
3. 理解已有数据模型；
4. 只重构模板和样式；
5. 保留 CMS 数据；
6. Preview；
7. 修复兼容问题；
8. 发布。

这体现 Persistent Website Workspace 的核心价值。

---

# 9. 第一版明确不做的东西

为了避免 MVP 失控，以下能力不进入第一版主目标：

- 完整 RBAC；
- 企业组织架构；
- 多人协作审批；
- 复杂 Tool Permission UI；
- WordPress；
- 多 CMS；
- 任意网站 URL 一键克隆；
- Figma 自动转 CMS；
- 完整拖拽编辑器；
- 页面可视化低代码编辑器；
- 多 Agent 编排平台；
- 自动 SEO 运营平台；
- 完整 GEO 平台；
- 自动域名购买；
- 自动云服务器购买；
- 复杂计费系统；
- Agency / To B 白标系统。

这些可以后续逐步增加。

---

# 10. 后续必须演进的权限系统

虽然第一版可以把权限全部给 Workspace Owner，但架构上必须避免把“Agent 永远拥有全部权限”写死。

建议长期模型：

```text
User
 ↓
Role / Policy
 ↓
Agent Session
 ↓
Capabilities
 ↓
Tools
 ↓
Workspace Resources
```

未来可能存在：

### Owner / Admin

可操作：

- 所有网站内容；
- 代码；
- 数据库；
- 部署；
- 用户；
- 权限；
- 域名；
- 备份；
- 回滚。

### Content / 运营

主要操作：

- 文章；
- 产品；
- FAQ；
- Banner；
- 图片；
- SEO 文案；
- CMS 内容。

默认不能执行危险 Shell 或直接操作数据库结构。

### Developer / 技术人员

可操作：

- HTML；
- CSS；
- JS；
- PHP；
- Git；
- 模板；
- 数据库 Migration；
- CMS 扩展。

### Ops / 运维

可操作：

- 部署；
- 服务状态；
- Nginx；
- PHP；
- SSL；
- 日志；
- 备份；
- 回滚。

---

# 11. 权限未来至少需要三层控制

## 11.1 Tool Permission

控制是否能调用：

```text
filesystem.read
filesystem.write
shell.exec
database.query
database.write
deploy
git.push
```

---

## 11.2 Resource Scope

即使能读取文件，也不等于能读取全部文件。

例如运营人员未来可能只能访问：

```text
template/
static/upload/
content-related resources
```

不能读取：

```text
.env
credentials
secret
system config
```

---

## 11.3 Action Approval

部分危险动作需要二次批准。

例如：

- 大量删除文件；
- DROP TABLE；
- ALTER TABLE；
- 批量 DELETE；
- 修改生产环境配置；
- 覆盖线上数据库；
- 删除网站；
- 修改域名；
- 直接发布大规模改动。

可以设计：

```text
允许
需要确认
禁止
```

三级策略。

---

# 12. Audit / 日志必须提前考虑

长期版本中，每一次 Agent 操作都应该可以追踪。

记录至少包括：

```text
Who
When
Workspace
Agent Session
Tool
Action
Resource
Before
After
Result
```

例如：

```text
User: user_123
Role: Content Editor
Action: 修改首页 Banner
Tool: cms.slide.update
Resource: slide_id=3
Result: success
```

代码改动可以关联：

```text
Git Commit
Diff
Agent Session
```

数据库操作可以关联：

```text
Transaction
Affected Rows
Structured Operation
```

最终应该能够实现：

> 查看某一次 Agent Run 做了什么。

甚至：

> 回滚某一次 Agent 修改。

---

# 13. Snapshot / Backup / Rollback

由于 Agent 拥有真实修改能力，后续必须支持：

```text
修改前
 ↓
Workspace Snapshot
 ↓
DB Backup
 ↓
Agent 修改
 ↓
验证
 ↓
Commit
```

失败时：

```text
Rollback
```

第一版不一定实现完整 Snapshot 系统，但架构和数据目录设计必须为其保留空间。

---

# 14. CMS 抽象

产品不能把核心逻辑完全绑定到 PbootCMS。

长期建议：

```text
                 Website Agent Core
                         │
                  CMS Capability
                         │
          ┌──────────────┴──────────────┐
          │                             │
   PbootCMS Adapter              WordPress Adapter
          │                             │
     Pboot CLI / DB                WP-CLI / REST
          │                             │
       PbootCMS                    WordPress
```

Agent 上层使用统一语义：

```text
listCategories()
createCategory()

listContent()
createContent()
updateContent()

uploadMedia()

getSiteConfig()
updateSiteConfig()

clearCache()
healthCheck()
```

底层具体怎么实现，由 CMS Adapter 决定。

---

# 15. CLI 的定位

CLI 不是产品核心协议，而是 CMS Adapter 的一种实现方式。

PbootCMS 可能使用：

```text
pboot-cli
```

WordPress 可以使用：

```text
wp-cli
```

其他 CMS 可能使用：

- REST API；
- GraphQL；
- PHP Command；
- Database Adapter；
- MCP；
- 自定义 CLI。

因此核心应该叫：

> CMS Capability Interface

而不是：

> Pboot CLI Interface。

---

# 16. Template / Renderer 也需要抽象

PbootCMS：

```text
template/
{pboot:list}
{pboot:sort}
```

WordPress：

```text
Theme
Block Theme
PHP Template
```

实现完全不同。

但上层可以统一理解：

```text
Page
Header
Footer
Navigation
Hero
ProductList
ArticleList
DetailPage
Form
FAQ
```

长期可形成：

```text
Site Structure
      ↓
CMS Renderer Adapter
      ↓
Pboot Template / WordPress Theme
```

第一版不用实现这个抽象体系，但目录与 Agent Prompt 不要把业务概念完全写死成 PbootCMS 文件路径。

---

# 17. 产品未来可能增加的能力

## 17.1 WordPress Adapter

在 Website Agent Core 稳定后接入 WordPress。

核心 Workspace、Agent、Browser、Git、Audit、Permission 不变。

替换：

- CMS Runtime；
- CMS Adapter；
- Template Adapter；
- 部分部署环境。

---

## 17.2 SEO Agent

后续可以增加：

- Title；
- Description；
- Canonical；
- Sitemap；
- robots.txt；
- Schema；
- 内链；
- 图片 Alt；
- URL；
- 404；
- Redirect；
- HTTP Status；
- IndexNow；
- 百度推送。

---

## 17.3 GEO / AEO Agent

可增加：

- FAQ；
- 实体信息；
- 作者信息；
- 来源引用；
- 结构化内容；
- Schema.org；
- AI Crawler 可读性检查；
- llms.txt 等实验能力；
- 内容语义优化。

不能把 GEO 当成固定标准，需要保持可演进。

---

## 17.4 Website Maintenance Agent

网站建完之后继续提供：

- 网站健康检查；
- 死链检查；
- 页面异常检查；
- 性能检查；
- 安全更新；
- CMS 更新；
- PHP 版本升级；
- 模板兼容性修复；
- 日志分析；
- 自动备份；
- 故障恢复。

---

## 17.5 Content Agent

用于：

- 新增产品；
- 新增文章；
- FAQ；
- 行业内容；
- 新闻；
- 产品描述；
- SEO 内容；
- 批量更新。

---

## 17.6 Reference-to-Site

后续支持：

```text
Reference URL
 ↓
结构分析
 ↓
视觉理解
 ↓
Site Manifest
 ↓
重新实现
 ↓
CMS Website
```

必须处理版权和模板授权问题。

优先支持：

- 已授权模板；
- 用户自己的网站；
- 开源模板；
- 客户提供设计稿；
- 合法购买模板。

不应默认把产品设计成“扒站工具”。

---

## 17.7 多人协作

后续一个 Workspace 可邀请：

- 老板；
- 运营；
- 开发；
- 运维；
- 外部服务商。

不同人员与 Agent 交互时获得不同 Capability。

---

# 18. 安全边界

长期需要考虑：

- Workspace 隔离；
- 用户之间不可互相读取；
- 文件访问白名单；
- Secret 隔离；
- 数据库权限；
- Shell 沙箱；
- 网络访问限制；
- 危险命令限制；
- Agent Tool 权限；
- 日志；
- 审计；
- Snapshot；
- Backup；
- Rollback；
- 生产环境审批；
- 多人协作冲突。

第一版可以放宽 Workspace 内权限，但绝不能放松 **Workspace 之间的隔离**。

---

# 19. Human 与 Agent 同时修改的问题

未来可能出现：

```text
运营人员
 ↓
CMS Admin 修改产品

同时

Agent
 ↓
批量调整产品栏目
```

需要考虑：

- 数据版本；
- 操作锁；
- 乐观锁；
- Git 状态；
- DB Transaction；
- 修改前快照；
- 冲突提示；
- Rollback。

第一版可先通过简单锁和单用户限制降低复杂度。

---

# 20. 产品真正的差异化

产品不应该把优势描述成：

> PbootCMS 比 React SEO 好。

长期真正差异应该是：

### 1. Persistent Website Workspace

网站不是一次生成，而是长期存在的工程环境。

### 2. Coding Agent 工作模式

Agent 可以理解、修改、运行、验证真实网站。

### 3. CMS Native

输出不是单纯 HTML，而是长期可运营的网站 CMS。

### 4. Self-hosted / 可迁移

最终网站是完整工程，而不是只能运行在某一个 AI SaaS 平台。

### 5. Long-term Maintenance

建站、改版、运营、故障、SEO、升级都在同一个 Workspace 中持续进行。

### 6. CMS 可替换

PbootCMS 是第一种 Runtime，而不是产品边界。

---

# 21. 产品主流程

```text
注册 / 登录
   ↓
创建网站
   ↓
创建 Website Workspace
   ↓
初始化 CMS Runtime
   ↓
选择模板 / 导入参考项目
   ↓
填写公司基础信息
   ↓
进入 Website Agent
   ↓
自然语言修改
   ↓
Agent Coding
   ↓
Run
   ↓
Browser Verify
   ↓
Preview
   ↓
用户确认
   ↓
Publish
   ↓
网站长期保留
   ↓
未来继续进入同一 Workspace 修改
```

---

# 22. 第一阶段重点验证问题

MVP 应重点验证以下问题，而不是追求功能数量。

## 22.1 Agent 是否能够稳定理解 PbootCMS 项目

包括：

- 模板目录；
- Pboot 标签；
- 数据；
- CSS；
- JS；
- 页面结构。

---

## 22.2 Agent 是否能够稳定修改一个真实网站

不是生成 Demo，而是：

- 改已有代码；
- 保留已有结构；
- 修复问题；
- 多轮修改。

---

## 22.3 Browser Feedback Loop 是否有效

即：

```text
Modify → Run → Observe → Fix → Verify
```

能否真正提升成功率。

---

## 22.4 Persistent Workspace 是否有价值

用户第二次、第三次回来修改时，是否明显优于重新生成网站。

---

## 22.5 CMS 数据操作是否稳定

验证：

- 直接 DB；
- CLI；
- PHP Script；
- API；

最终选择更稳定的 CMS Adapter 方案。

---

## 22.6 网站能否真正上线

最终必须是：

> 一个真实域名可访问、后台可登录、后续可继续运营的网站。

而不是只在 Sandbox 中展示。

---

# 23. 暂时明确推迟讨论的问题

以下问题非常重要，但本轮暂不确定：

## 基础设施

- Workspace 使用 Docker、VM、MicroVM 还是其他方案；
- 每个 Workspace 是否独立服务器；
- 是否共享宿主机；
- 文件系统隔离方式；
- CPU / RAM 配额；
- Workspace Sleep / Wake；
- 数据持久化；
- Remote Shell；
- Agent 如何连接 Workspace。

## 部署

- Preview 与 Production 是否同环境；
- Nginx 如何配置；
- PHP-FPM 如何管理；
- 发布是否 Copy / Git / Image；
- Rollback 怎么做；
- Production 是否独立环境。

## 域名

- 用户自有域名；
- 平台二级域名；
- 域名购买；
- DNS；
- ICP 备案；
- SSL；
- 国内 / 海外服务器。

## 计费

- 按 Workspace；
- 按 Agent Token；
- 按服务器资源；
- 按网站；
- 按部署；
- 套餐。

以上内容留到后续单独设计。

---

# 24. 当前阶段产品决策

目前已经确定：

1. **产品是 To C，不以建站公司作为中间角色。**
2. **每个网站拥有独立、长期存在的 Website Workspace。**
3. **核心交互方式是 Coding Agent，而不是拖拽编辑器。**
4. **Agent 直接操作真实代码和运行环境。**
5. **第一版使用 PbootCMS。**
6. **第一版允许 Owner 拥有较高 Workspace 权限。**
7. **权限系统第一版不完整实现，但架构必须预留。**
8. **PbootCMS 后台继续服务于普通人工内容管理。**
9. **Agent 不需要通过 CMS Web Admin 模拟人类操作。**
10. **必须存在 Run / Browser / Verify 的闭环。**
11. **需要 Git、日志、备份、回滚意识。**
12. **长期支持多角色与 Tool Scope。**
13. **长期支持 WordPress 等其他 CMS。**
14. **核心架构不能完全绑定 PbootCMS。**
15. **服务器、远程连接、域名、部署基础设施留到下一阶段讨论。**

---

# 25. 项目品牌与产品术语

项目正式品牌为：

**CloudCrane（筑云鹤）**

其中，“筑”代表建设，“云”代表互联网 / 云端，“鹤”是品牌意象。

本文中的 **Website Coding Agent** 保留为产品类别与核心能力名称，用于准确描述“像 Coding Agent 一样开发和长期维护真实网站”的产品形态，不再作为项目正式名称。

相比：

- AI Website Builder；
- AI 建站；
- PbootCMS AI；

它更准确表达产品本质：

> **像 Coding Agent 一样开发和长期维护真实网站。**

后续商业化命名可以在品牌体系基础上继续完善。

---

# 26. 下一阶段应讨论什么

产品形态冻结后，下一阶段应该进入真正影响可实现性的基础设施设计：

### 第一优先级

**Website Workspace 到底是什么？**

需要确定：

- VM / Container / MicroVM；
- PHP Runtime；
- 数据持久化；
- 文件系统；
- Shell；
- Browser；
- 网络；
- Preview；
- Workspace 生命周期。

### 第二优先级

**Agent 如何远程操作 Workspace？**

需要确定：

- Tool Gateway；
- Shell；
- File API；
- Search；
- Edit；
- DB；
- Git；
- Browser；
- 权限拦截；
- Session。

### 第三优先级

**Preview → Production 如何发布？**

然后再继续：

- 域名；
- SSL；
- DNS；
- 备案；
- 服务器资源；
- 成本；
- 计费。

---

## 最终产品愿景

长期目标不是：

> 帮用户生成一个网站。

而是：

> **每一个网站都有一个长期在线的 Website Workspace，以及一个真正理解该网站代码、CMS、运行状态和历史的 Website Coding Agent。**

用户从第一次建站开始，到后续改版、加产品、修 Bug、做 SEO/GEO、升级 CMS、排查线上问题，都可以继续在同一个 Workspace 中完成。

**网站是长期资产，Agent 是这个网站长期存在的技术执行者。**
