# 技能（Skills）

侧栏 → **技能**

技能是可安装的 Markdown 提示词模块，用于扩展 Agent 在专项知识或工作流上的能力。它们仅在模型判断相关时才被加载到系统提示词中，闲置时不占用上下文成本。

## 存储位置

技能文件存于 `~/.sbot/skills/`。每个技能是一份 `SKILL.md` 文件，包含 frontmatter（`name`、`description`）以及正文。

## 安装

添加方式：

- **从市场搜索安装** —— 内置注册源：Clawhub、skills.sh、skillhub.cn
- **通过 URL 安装** —— 粘贴受支持的 Skill Hub 地址
- **通过 ZIP 安装** —— 上传一个或多个包含 `SKILL.md` 的 `.zip` 文件
- **手动放入** —— 直接把 `SKILL.md` 文件放入 `~/.sbot/skills/`

## 分配

进入 Agent → **技能** 标签页：

- 选择具体的技能加载
- 或留空表示加载 **所有** 可用技能（由 Agent 按轮次自行选择）

## 编写

最小示例：

```markdown
---
name: web-scraper
description: 当用户要求从网页提取结构化数据时使用
---

# Web Scraper

当用户提供 URL 时...
```

`description` 是触发该技能的关键 —— 写得越具体，模型就越容易判断何时调用。
