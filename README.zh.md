# sbot — 自托管 AI Agent 服务

[![npm version](https://img.shields.io/npm/v/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![npm downloads](https://img.shields.io/npm/dm/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**开源、自托管的 AI Agent 框架。** 在自己的服务器上运行 LLM 驱动的 Agent，支持持久化记忆、多渠道接入、MCP 工具协议和内置 Web UI —— 无供应商绑定。

---

## 快速开始

### npm

```bash
npm install -g @qingfeng346/sbot
sbot
# 打开 http://localhost:5500
```

如果 5500 端口被占用，可修改端口：

```bash
sbot port 3000        # 保存端口并退出
sbot --port 3000      # 保存端口并启动
```

### Docker

```bash
docker pull qingfeng346/sbot
docker run -d \
  -p 5500:5500 \
  -v ~/.sbot:/root/.sbot \
  --name sbot \
  qingfeng346/sbot
# 打开 http://localhost:5500
```

配置和数据持久化在宿主机的 `~/.sbot` 目录中。

---

## 核心特性

- **多 LLM 供应商** — OpenAI、Anthropic Claude、Azure OpenAI、Ollama，以及任何 OpenAI 兼容接口（Groq、Mistral、DeepSeek 等）。每个模型可独立配置 API Key、Base URL、温度和 Token 上限。
- **多 Agent 编排** — ReAct 模式：思考模型拆解任务并分发给专项子 Agent，支持递归组合
- **长期记忆** — 完整的提取 → 评估 → 压缩流水线，基于向量 Embedding 进行语义检索
- **MCP 支持** — 通过 stdio 或 HTTP/SSE 接入外部工具服务器
- **多渠道接入** — Web UI、CLI、飞书/Lark、Slack、企业微信、REST API、WebSocket
- **内置工具** — Shell 执行、文件系统、归档操作、二进制文件读取、Python/PowerShell 内联执行、Cron 调度
- **技能系统** — 可安装的 Prompt 模块，涵盖头脑风暴、TDD、代码审查、多 Agent 协作等
- **灵活配置** — 单个 `settings.json`，支持全局、目录、会话三级覆盖

---

## 使用指南

启动后打开 `http://localhost:5500`，按以下步骤操作：

**1. 添加模型** — 侧栏 → **模型** → 新建

填写 provider、API Key、Base URL 和模型名。支持 OpenAI、Anthropic、Azure OpenAI、Ollama，以及任何兼容 OpenAI 的接口（Groq、Mistral、DeepSeek 等）。

---

**2. 创建 Saver** — 侧栏 → **存储** → 新建

选择对话历史的持久化后端：

| 后端 | 说明 |
|---|---|
| 内存 | 仅保留在进程内，不写磁盘 |
| SQLite | 每个 Saver 实例独立的本地 SQLite 数据库（推荐） |
| PostgreSQL | 外部数据库，适合生产环境部署 |
| 文件 | 每个会话线程存储为独立 JSON 文件 |

---

**3. 创建 Agent** — 侧栏 → **Agent** → 新建

选择运行模式：
- **Single** — 选择模型，填写系统提示词，按需挂载 MCP 工具和技能
- **ReAct** — 选择 Think 模型，添加子 Agent（每个子 Agent 需填写描述，供 Think 模型调度决策）。Think 模型递归拆解任务并分发；每个子 Agent 对共享记忆拥有只读权限。

→ [MCP 工具](#mcp-工具) · [Skills 技能](#skills-技能)

---

**4. 开始对话** — 选择接入方式

- **会话** — 侧栏 → **聊天** → 新建会话，选择 Agent + Saver + Memory
- **目录** — 侧栏 → **目录**，注册本地路径，配置 Agent / Saver / Memory
- **渠道**（即时通讯）— 侧栏 → **渠道** → 新建 → [渠道配置](#渠道配置)

---

**5. （可选）开启 Memory** — 侧栏 → **记忆** → 新建

需先创建 Embedding 模型（侧栏 → **向量模型** → 新建）。创建后将 Memory 分配给会话、目录或渠道。

| 字段 | 说明 |
|------|------|
| 模式 | `read_only` 只读 / `human_only` 仅记用户消息 / `human_and_ai` 记录双方 |
| 最大保留天数 | 到期自动清理 |
| 向量模型 | 用于语义检索（支持 OpenAI、Azure、Ollama） |
| 评估模型 | 评估记忆重要性（0–1 打分） |
| 提取模型 | 从对话中提取关键事实 |
| 压缩模型 | 合并相似记忆，减少冗余 |
| 共享 | 关闭 = 每 thread 独立；开启 = 所有 thread 共享 |

---

**6. （可选）添加 MCP 工具** — 侧栏 → **MCP** → 新建

添加工具服务器：
- **stdio** — 填写命令和参数（如 `npx -y some-mcp-package`）
- **http** — 填写远程 URL 和可选请求头

支持全局共享服务器和 Agent 级别独立配置，故障自动重启。然后打开 Agent 编辑页 → MCP 标签页挂载所需服务器。

---

**7. （可选）管理技能** — 侧栏 → **技能**

技能文件（Markdown 格式）存储在 `~/.sbot/skills/`，可在技能页面安装，也可手动放入文件夹。在 Agent 编辑页 → 技能标签页中选择要加载的技能，不选则全部加载。

内置技能：`brainstorming`、`planning`、`debugging`、`tdd`、`code-review`、`multi-agent`。通过 `find-skills` 技能可搜索并安装来自 Clawhub、skills.sh 等远程平台的技能。

---

**8. （可选）自定义提示词** — 侧栏 → **提示词**

查看和编辑任意内置提示词，保存后存储在 `~/.sbot/prompts/` 并覆盖默认值，立即生效无需重启。

| 提示词 | 用途 |
|--------|------|
| `system/init.txt` | 所有 Agent 共享的前置系统提示 |
| `skills/system.txt` | Skills 子系统提示模板 |
| `agent/react_system.txt` | ReAct Think 节点系统提示 |
| `agent/react_subnode.txt` | ReAct 子 Agent 任务提示模板 |

提示词支持 `{varName}` 占位符，运行时自动替换。

---

### 渠道配置

在 **渠道 → 新建** 中选择类型，填写凭据，再分配 Agent + Saver + Memory。每个用户/群聊的会话自动隔离。

| 类型 | 必填字段 |
|------|---------|
| Lark / 飞书 | App ID、App Secret |
| Slack | Bot Token（`xoxb-...`）、App Token（`xapp-...`）|
| 企业微信 WeCom | Bot ID、Secret |

**配置飞书 / Lark：**
1. 在[飞书开放平台](https://open.feishu.cn)创建自建应用
2. 开启**机器人**能力，订阅 **message.receive** 事件
3. 在 Web UI → **渠道** 中创建 Lark 渠道，填入 **App ID** 和 **App Secret**

飞书集成支持事件去重、互动卡片、多用户上下文隔离，以及文件和图片的收发。

---

## 内置工具

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
- 二进制文件读取

**归档工具**
- 压缩与解压归档文件
- 列举归档内容
- 直接读取归档内部文件

**调度器**
- 标准 6 字段 Cron 表达式（秒 分 时 日 月 周），服务重启后任务自动恢复
- 任务可指向渠道用户、Web 会话或工作目录
- 可设置最大执行次数，到达上限后自动清理
- 可通过 Web UI 管理，也可直接让 Agent 创建定时任务

**Ask（交互提问）**
- Agent 在执行过程中可随时暂停并向用户提问
- 支持四种问题类型：单选、多选、文本输入、开关
- 支持 Web UI 和飞书；用户回答后 Agent 自动继续执行

---

## 关键词

`AI Agent` `自托管` `大模型服务` `开源` `MCP` `模型上下文协议` `多智能体` `ReAct` `OpenAI` `Claude` `Ollama` `聊天机器人` `飞书` `Lark` `长期记忆` `向量检索` `TypeScript` `Node.js`
