# Asset Library Skill

`Asset Library Skill` 是一组围绕“个人材料资产库”设计的技能。它的目标不是做一个普通的文件分类器，而是帮助你把散落在下载目录、网盘、聊天记录和相册里的材料，整理成一套可以长期维护、随时检索、反复复用的个人资产库。

## 它适合做什么

- 导入个人材料并建立资产库
- 从证书、成绩单、简历、证明、票据等材料中提取可复用资产
- 维护资产库：修订、归档、恢复、复核
- 用自然语言查找材料
- 检查哪些材料即将到期、需要续办或补件
- 生成申请或归档场景下的材料包

## 它不是什么

- 不是独立的 Web 应用
- 不是通用网盘
- 不是面向多人协作的文档系统
- 当前默认主线不包含自动提交外部演示页

## 它如何工作

这套 skill 采用分阶段的方式工作：

1. `Import Personal Documents`
   把本地材料导入系统，并形成可继续处理的输入。
2. `Build Personal Asset Library`
   从材料中提取个人资产，建立资产库。
3. `Maintain Personal Asset Library`
   对资产做人工修订、归档、恢复和复核。
4. `Search Personal Asset Library`
   用关键词、标签或自然语言查找材料。
5. `Check Document Renewal Requirements`
   找出未来需要续办、补办或复核的材料。
6. `Build Application Document Package`
   为申请、归档或展示场景生成材料包。

根级主入口 skill 叫做 [Asset Library Skill](./SKILL.md)。当你不确定应该从哪个阶段开始，或者想一次表达整条主线时，就从它开始。

## 典型使用方式

你可以直接这样描述你的意图：

- “把我下载目录里的个人材料建成资产库。”
- “帮我找可用于暑期实习申请的证明材料。”
- “检查一下未来 60 天有哪些材料需要续办。”
- “把这份资产库里明显不该保留的材料归档。”
- “生成一份申请材料包。”

## 这套技能的特点

- 以“个人资产库”为中心，而不是一次性任务脚本
- 支持持续维护，而不只是导入一次
- 能结合结构化字段、语义标签和本地检索能力查找材料
- 对不确定信息尽量保守处理，宁缺勿错

## 当前主线

当前 MVP 的重点是：

- 导入建库
- 资产维护
- 稳定查询
- 生命周期检查
- 材料打包

自动提交外部演示页仍保留为高级可选扩展，不属于默认主线。

## 快速开始

如果你是第一次使用：

1. 先查看 [SKILL.md](./SKILL.md)，了解主入口如何路由
2. 再查看 [references/install.md](./references/install.md)，完成必要配置
3. 安装完成后，从导入或建库阶段开始

如果你已经有一套资产库：

1. 直接使用 `Search Personal Asset Library`
2. 或使用 `Maintain Personal Asset Library` 做修订与整理

## 文档入口

- 主入口 Skill：[SKILL.md](./SKILL.md)
- 安装说明：[references/install.md](./references/install.md)
- 技能总览：[docs/skills/README.md](./docs/skills/README.md)
- MCP 工具说明：[docs/mcp/README.md](./docs/mcp/README.md)
- 主规格书：[SPEC.md](./SPEC.md)

如果你想看比赛背景或作品说明，请转到 [README.comp.md](./README.comp.md)。
