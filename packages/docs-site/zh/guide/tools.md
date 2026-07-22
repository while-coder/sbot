# 内置工具

这些工具以内置提供者形式开箱即用，无需安装额外包。可在 Agent 编辑页按需开关；少数工具还依赖当前 Saver 或渠道上下文。

## 命令执行

- Shell 命令与脚本（bash / pwsh / cmd）
- Python 与 PowerShell 内联执行
- 引用磁盘脚本文件执行
- 每条命令可独立配置超时时间

## 文件系统

- 读取、写入、编辑文件
- 正则内容搜索（grep）
- 按模式匹配查找文件（glob）
- 目录列举、创建、删除、移动、复制
- 媒体文件读取（图片等）
- 支持按 Agent 启用只读模式

## 归档工具

- 创建与解压 ZIP 文件
- 列举 ZIP 内容
- 直接读取 ZIP 内部文件

## Web 工具

- 抓取网页 URL 并转换为干净的 Markdown
- 从网络下载文件

## 会话搜索

- 当当前 Saver 支持历史归档检索时，搜索过往对话
- 支持多组关键词匹配，并返回角色、时间与内容预览

## 渠道工具

- 查询已配置渠道、渠道会话和已知用户
- 让 Agent 工作流向其他渠道会话或用户发送消息

## 内置 MCP 预设

MCP 页面还会列出 Playwright、Markitdown、Exa 等内置预设。它们按 MCP 服务器方式管理，而不是本地工具；可在 [MCP 工具](./mcp) 或 Agent 的 MCP 标签页中启用。

## 知识与记忆

当 [Notes](./note)、[Wiki](./wiki)、[Memory](./memory) 或 [Agenda](./agenda) 在会话 / 渠道中启用时，Agent 会自动获得对应的工具：

- **Notes** —— `note_search`，召回向量索引中的笔记
- **Wiki** —— `wiki_search` / `wiki_read`，搜索并读取已分配的 Wiki 页面
- **Memory** —— `search_memory` / `read_memory`，召回后台提取的长期记忆
- **Agenda** —— `agenda_create` / `agenda_list` / `agenda_update` / `agenda_complete` / `agenda_cancel` / `agenda_trigger`，管理提醒与日程
