# 内置工具

这些工具对每个 Agent 都开箱即用，无需任何配置。可在 Agent 编辑页按需开关。

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

- 压缩与解压归档文件（zip、tar、gz 等）
- 列举归档内容
- 直接读取归档内部文件

## Web 工具

- 抓取网页 URL 并转换为干净的 Markdown
- 从网络下载文件

## 调度器（Scheduler）

- 标准 6 字段 Cron 表达式（`秒 分 时 日 月 周`）
- 服务重启后任务自动恢复
- 任务可指向渠道用户、Web 会话或工作目录
- 可设置最大执行次数，到达上限后自动清理
- 可在 Web UI 管理，也可直接让 Agent 创建定时任务

## 待办（Todo）

- Agent 可创建、完成和查询待办任务
- Web UI 提供 Todo 管理页面

## 提问（Ask）

- Agent 在执行过程中可暂停并向用户提出结构化问题
- 支持的题型：单选、多选、文本输入
- 兼容 Web UI 与飞书；用户回答后 Agent 自动继续

## 知识与记忆

当 [Notes](./note)、[Wiki](./wiki)、[Memory](./memory) 或 [Agenda](./agenda) 在会话 / 渠道中启用时，Agent 会自动获得对应的工具：

- **Notes / Wiki** —— 读取、写入、检索和更新条目
- **Memory** —— `search_memory` / `read_memory`，召回后台提取的长期记忆
- **Agenda** —— `agenda_create` / `agenda_list` / `agenda_update` / `agenda_complete` / `agenda_cancel` / `agenda_trigger`，管理提醒与日程
