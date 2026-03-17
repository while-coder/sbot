# sbot — 自托管 AI Agent 服务

[![npm version](https://img.shields.io/npm/v/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![npm downloads](https://img.shields.io/npm/dm/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**开源、自托管的 AI Agent 框架。** 在自己的服务器上运行 LLM 驱动的 Agent，支持持久化记忆、多渠道接入、MCP 工具协议和内置 Web UI —— 无供应商绑定。

> 同类项目对比：OpenClaw · BotSharp · Anything LLM · OpenAgents · LobeChat

---

## 快速开始

```bash
npm install -g @qingfeng346/sbot
sbot
```

首次运行时，交互式引导向导会自动生成合理的默认 `settings.json`。

---

## 为什么选择 sbot？

| 功能 | sbot | Anything LLM | OpenClaw |
|---|:---:|:---:|:---:|
| 自托管 | ✅ | ✅ | ✅ |
| 多 LLM 供应商 | ✅ | ✅ | ✅ |
| 持久化长期记忆 | ✅ | ✅ | — |
| 多 Agent 编排（ReAct）| ✅ | — | — |
| MCP（模型上下文协议）| ✅ | — | — |
| 飞书 / Lark 集成 | ✅ | — | — |
| Cron 定时调度 | ✅ | — | — |
| 技能 / Prompt 模块 | ✅ | — | — |

---

## 核心特性

- **多 LLM 供应商** — OpenAI、Anthropic Claude、Azure OpenAI、Ollama，以及任何 OpenAI 兼容接口（Groq、Mistral、DeepSeek 等）
- **多 Agent 编排** — ReAct 模式：思考模型拆解任务并分发给专项子 Agent，支持递归组合
- **长期记忆** — 完整的提取 → 评估 → 压缩流水线，基于向量 Embedding 进行语义检索
- **MCP 支持** — 通过 stdio 或 HTTP/SSE 接入外部工具服务器
- **多渠道接入** — Web UI、CLI、飞书/Lark、REST API、WebSocket
- **内置工具** — Shell 执行、文件系统、Python/PowerShell 内联执行、Cron 调度
- **技能系统** — 可安装的 Prompt 模块，涵盖头脑风暴、TDD、代码审查、多 Agent 协作等
- **灵活配置** — 单个 `settings.json`，支持全局、目录、会话三级覆盖

---

## LLM 模型支持

- **OpenAI** — GPT 系列模型
- **Anthropic** — Claude 系列模型
- **Azure OpenAI** — Azure 托管的 OpenAI 部署
- **Ollama** — 本地运行的模型（无需 API Key）
- **OpenAI 兼容接口** — Groq、Mistral、DeepSeek 等任何兼容 OpenAI 格式的服务

每个模型可独立配置 API Key、Base URL、温度参数和 Token 上限。

---

## Agent 模式

### Single（单 Agent）
单个 LLM 挂载工具和技能，适合通用助手场景。

### ReAct（多 Agent 编排）
由思考模型分析任务并将子任务分发给专项子 Agent，子 Agent 支持递归组合。每个子 Agent 对共享记忆拥有只读权限。

---

## 长期记忆

完整的提取 → 评估 → 压缩流水线：

- **提取** — 自动从对话中识别关键信息
- **评估** — 对记忆重要性打分（0–1）
- **压缩** — 合并相关记忆，减少冗余
- **检索** — 基于向量 Embedding 的语义搜索（支持 OpenAI、Azure、Ollama）
- **自动清理** — 可配置保留天数，过期自动删除

记忆模式：只读 / 仅存储用户消息 / 存储完整对话。

---

## 对话持久化

四种对话历史存储后端：

| 后端 | 说明 |
|---|---|
| 内存 | 仅保留在进程内，不写磁盘 |
| SQLite | 每个 Saver 实例独立的本地 SQLite 数据库 |
| PostgreSQL | 外部数据库，适合生产环境部署 |
| 文件 | 每个会话线程存储为独立 JSON 文件 |

---

## 接入渠道

### 飞书 / Lark
企业 IM 集成，支持事件去重、互动卡片和多用户上下文隔离。

### Web UI
基于浏览器的聊天界面，支持实时流式输出、附件上传、Agent 与会话切换。

### HTTP + WebSocket
REST API 与 WebSocket 端点，供自定义客户端或程序化接入。

### CLI
终端 TUI 界面，内置首次使用引导向导，支持实时流式输出。

---

## 工具

### 内置工具组

**命令执行**
- Shell 命令与脚本
- Python / PowerShell 内联执行
- 引用磁盘脚本文件执行
- 每条命令可独立配置超时时间

**文件系统**
- 读取、写入、编辑文件
- 正则内容搜索（grep）
- 按模式匹配查找文件（glob）
- 目录列举、创建、删除、移动、复制

**调度器**
- 查看、创建、删除定时任务
- Cron 表达式格式

### MCP（模型上下文协议）

完整的 MCP 协议支持，用于接入外部工具服务器：

- `stdio` 传输 — 通过子进程 stdin/stdout 通信
- `http` 传输 — 远程 HTTP/SSE 服务器
- 全局 MCP 服务器，可在多个 Agent 间共享
- 每个 Agent 可单独配置 MCP 服务器
- 故障自动重启

---

## 技能（Skills）

技能是独立的 Prompt 模块，用于为 Agent 扩展特定领域的能力或工作流：

- 从全局技能目录加载
- 限定为单个 Agent 专用
- 从远程技能市场（Clawhub、skills.sh 等）搜索并安装

内置技能涵盖：头脑风暴、任务规划、系统调试、TDD、代码审查、多 Agent 协作等工作流。

---

## 定时调度

基于 Cron 的任务调度器，持久化存储：

- 标准 5 字段 Cron 表达式
- 服务重启后任务自动恢复
- 可设置最大执行次数，到达上限后自动清理
- 任务可指向渠道用户、Web 会话或工作目录

---

## 配置

所有配置集中在一个 `settings.json` 文件中，支持三级覆盖：

1. **全局级** — 对所有 Agent 和渠道生效
2. **目录级** — 通过项目内的 `.sbot/settings.json` 覆盖
3. **会话级** — 通过 Web 或 CLI 对单个会话指定不同的模型、Saver 和记忆配置

首次启动时自动生成配置示例文件。

---

## 同类项目

- [OpenClaw](https://github.com/search?q=openclaw) — 同类自托管 AI Agent 框架
- [Anything LLM](https://github.com/Mintplex-Labs/anything-llm) — 自托管 LLM 桌面/服务端应用
- [LobeChat](https://github.com/lobehub/lobe-chat) — 开源 ChatGPT/Claude UI
- [Open Interpreter](https://github.com/OpenInterpreter/open-interpreter) — LLM 驱动的代码执行 Agent
- [BotSharp](https://github.com/SciSharp/BotSharp) — 开源 AI Agent 框架（.NET）

---

## 关键词

`AI Agent` `自托管` `大模型服务` `开源` `MCP` `模型上下文协议` `多智能体` `ReAct` `OpenAI` `Claude` `Ollama` `聊天机器人` `飞书` `Lark` `长期记忆` `向量检索` `TypeScript` `Node.js`
