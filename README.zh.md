# sbot — 自托管 AI Agent 服务

[English](https://github.com/while-coder/sbot/blob/main/README.md) | **中文**

[![npm version](https://img.shields.io/npm/v/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![npm downloads](https://img.shields.io/npm/dm/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**开源、自托管的 AI Agent 框架。** 模块化配置：模型、记忆、工具、渠道均可独立组合，按需搭建 Agent —— 在自己的服务器上运行，支持多渠道接入、MCP 工具协议和内置 Web UI，无供应商绑定。

---

## 快速开始

### npm

```bash
# 安装
npm install -g @qingfeng346/sbot

# 启动（前台），随后访问 http://localhost:5500
sbot

# 后台启动（关闭终端不退出）
sbot -d

# 指定端口启动（5500 被占用时使用）
sbot -p 3000

# 仅保存端口，不启动服务
sbot port 3000
```

完整命令列表：

| 命令 | 说明 |
|------|------|
| `sbot` | 启动服务（前台） |
| `sbot -d` / `--daemon` | 后台启动（关闭终端不退出） |
| `sbot -p <port>` / `--port` | 指定端口启动，如 `sbot -p 3000` |
| `sbot port <port>` | 仅修改并保存端口，不启动服务 |
| `sbot stop` | 关闭正在运行的服务 |
| `sbot status` | 查看运行状态、端口、自启动、版本、配置目录 |
| `sbot -v` / `--version` | 查看版本并检查更新 |
| `sbot startup enable` | 开启开机自启动 |
| `sbot startup disable` | 取消开机自启动 |
| `sbot startup status` | 查看开机自启动状态 |

<details>
<summary>macOS 安装时报权限错误（EACCES）？</summary>

执行 `npm install -g` 时如果报 `EACCES: permission denied`，**不建议用 `sudo` 强行安装**——之后很容易出现各种文件归属混乱。推荐做法是在用户目录下另建一个全局包目录，把 npm 装到这里，从根源上避开系统目录的权限限制。

**一键脚本**（推荐，自动识别 zsh / bash，复制整段粘贴到终端回车即可）：

```bash
mkdir -p ~/.npm-global && \
npm config set prefix '~/.npm-global' && \
RC_FILE=$([ "${SHELL##*/}" = "bash" ] && echo ~/.bash_profile || echo ~/.zshrc) && \
grep -q '.npm-global/bin' "$RC_FILE" 2>/dev/null || echo 'export PATH=~/.npm-global/bin:$PATH' >> "$RC_FILE" && \
source "$RC_FILE" && \
echo "✓ 完成，现在可以执行: npm install -g @qingfeng346/sbot"
```

**手动步骤**（想了解每一步在做什么时使用）：

```bash
# 1. 创建用户级全局目录
mkdir ~/.npm-global

# 2. 让 npm 指向这个目录（全局包装到这里，不再写入系统路径）
npm config set prefix '~/.npm-global'

# 3. 把它加入 PATH，这样终端才能找到全局命令
#    zsh（macOS 默认终端）：
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc && source ~/.zshrc
#    bash：
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bash_profile && source ~/.bash_profile
```

完成后重新执行 `npm install -g @qingfeng346/sbot` 即可。

</details>

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

### Docker Compose

适合长期运行、希望版本受控、便于一键升级的场景。新建 `docker-compose.yml`：

```yaml
services:
  sbot:
    image: qingfeng346/sbot
    container_name: sbot
    ports:
      - "5500:5500"
    volumes:
      - ~/.sbot:/root/.sbot
    environment:
      - TZ=Asia/Shanghai
      - LOG_LEVEL=INFO
    restart: unless-stopped
```

常用命令：

```bash
docker compose up -d            # 后台启动
docker compose logs -f          # 查看日志
docker compose down             # 停止并移除容器（数据保留在 ~/.sbot）
docker compose pull && docker compose up -d   # 升级到最新镜像
```

---

## 核心特性

- **模块化组合** — 模型、记忆、工具、渠道、技能均为独立模块，自由搭配搭建 Agent，无固定套路
- **一条命令部署** — `npm install -g` 或 `docker run`，跨平台原生运行，无额外系统依赖
- **全 Web UI 管理** — 所有配置在浏览器中完成，无需手动编辑文件
- **多 LLM 供应商** — OpenAI、Anthropic Claude、Google Gemini、Ollama，以及任何 OpenAI 兼容接口（Azure OpenAI、Groq、Mistral、DeepSeek 等）；网络抖动自动指数退避重试
- **多 Agent 编排** — Single、ReAct（递归任务分解）、Generative（多模态生成）三种模式，Agent 可嵌套组合
- **ACP Agent 支持** — Agent Client Protocol 集成，支持持久化和临时两种 Agent 模式
- **知识库** — 内置 Wiki 系统，关键词与语义混合检索，Agent 对话中自动引用
- **长期记忆** — 基于向量 Embedding 的语义检索（OpenAI、Google、Ollama、Cohere、VoyageAI），持久化上下文记忆
- **对话压缩** — Token 用量超阈值时自动摘要压缩，保持上下文连续性的同时降低消耗
- **Insight 洞察** — 按 Agent 配置的静默后置提取器，将用户偏好、项目事实、经验教训沉淀为可复用的 Markdown 笔记，并按使用情况自动标记陈旧、归档过期
- **心跳唤醒** — 可配置定时提示词，让 Agent 在任意渠道周期性主动发起任务
- **MCP 工具** — 标准 MCP 协议（stdio/SSE），接入任意 MCP 工具生态；支持全局与 Agent 级独立配置，故障自动重启
- **多渠道接入** — Web UI、CLI、飞书/Lark、Slack、企业微信、微信、钉钉、QQ（官方机器人）、OneBot（v11 反向 WebSocket）、小爱音箱、REST API、WebSocket
- **内置工具** — Shell 执行、文件系统、归档操作、媒体文件读取、Python/PowerShell 内联执行、Web 抓取/下载、Cron 调度、待办事项
- **技能系统** — 可安装的 Prompt 模块，支持从 Clawhub、skills.sh、skillhub.cn 远程安装
- **Agent 商店** — 浏览并一键安装预打包 Agent（含模型、Prompt、工具、技能、MCP 服务器配置），支持自定义源
- **Token 用量追踪** — 按模型统计消耗，模型响应缓存命中率可视化
- **无人值守安全** — 渠道支持审批超时与提问超时配置，长时间运行更可靠
- **灵活配置** — 单个 `settings.json`，支持全局和会话两级覆盖；提示词热更新无需重启

---

## 使用指南

启动后打开 `http://localhost:5500`，按以下步骤操作：

**1. 添加模型** — 侧栏 → **模型** → 新建

填写 provider、API Key、Base URL 和模型名。支持 OpenAI、Anthropic、Google Gemini、Ollama，以及任何兼容 OpenAI 的接口（Azure OpenAI、Groq、Mistral、DeepSeek 等）。

---

**2. 创建 Saver** — 侧栏 → **存储** → 新建

选择对话历史的持久化后端：

| 后端 | 说明 |
|---|---|
| 文件 | 每个会话线程存储为独立 JSON 文件（推荐） |
| SQLite | 本地 SQLite 数据库 |
| 内存 | 对话完成后即清空，不持久化，适合一次性对话或问答助手 |

---

**3. 创建 Agent** — 侧栏 → **Agent** → 新建

选择运行模式：
- **Single** — 选择模型，填写系统提示词，按需挂载 MCP 工具和技能
- **ReAct** — 选择 Think 模型，添加子 Agent（每个子 Agent 需填写描述，供 Think 模型调度决策）。Think 模型递归拆解任务并分发；每个子 Agent 对共享记忆拥有只读权限
- **Generative** — 选择多模态模型，支持图文混合内容生成

→ [MCP 工具](#添加-mcp-工具) · [技能](#管理技能)

---

**4. 开始对话** — 选择接入方式

- **会话** — 侧栏 → **聊天** → 新建会话，选择 Agent + Saver + Memory，可配置工作目录
- **渠道**（即时通讯）— 侧栏 → **渠道** → 新建 → [渠道配置](#渠道配置)，可配置工作目录

---

**5. （可选）开启 Wiki 知识库** — 侧栏 → **Wiki** → 新建

内置知识库系统，可手动创建词条（标题 + 内容 + 标签）。创建后将 Wiki 分配给会话或渠道，Agent 对话时可通过内置工具搜索、读取、写入和更新词条。可选填 Embedding 模型以启用语义检索（不填则退回纯关键词检索）。

| 字段 | 说明 |
|------|------|
| 名称 | Wiki 标识 |
| 向量模型 | 可选，启用语义检索；不填则使用关键词匹配 |

---

**6. （可选）开启 Memory** — 侧栏 → **记忆** → 新建

Agent 可通过工具调用读写的向量库。需先创建 Embedding 模型（侧栏 → **向量模型** → 新建），然后将 Memory 分配给会话或渠道。检索时按时间衰减加权，写入时自动去重。

| 字段 | 说明 |
|------|------|
| 名称 | Memory 标识 |
| 向量模型 | 用于语义检索（OpenAI、Google、Ollama、Cohere、VoyageAI） |

---

**7.（可选）为 Agent 启用 Insight** — Agent 编辑页 → Insight 区块

Insight 是 Agent 级别的静默后置提取器，每轮对话结束后自动运行，将持久价值的知识（用户偏好、项目事实、经验教训）沉淀为可复用的 Markdown 笔记（存放在 `~/.sbot/insights/` 下的 `SKILL.md` 文件）。后续对话开始时，相关 Insight 会通过关键词 + 语义混合检索自动注入到系统提示词中。

| 字段 | 说明 |
|------|------|
| Scope | `Disabled` 关闭 / `Per Agent` 该 Agent 跨会话共享 / `Per Session` 按 thread 隔离 |
| 提取模型 | 用于运行后置提取的模型（一般选成本低、速度快的小模型） |
| 提取提示词 | 来自 `~/.sbot/prompts/insight/extractor/` 的提示词文件，决定提取内容 |

提取器会根据对话演进对 Insight 执行 `create`（新增）、`patch`（修订）、`delete`（移除）操作。长期未用（默认 30 天）的 Insight 会被标记为陈旧，超期未用（默认 90 天）的会自动归档。

---

**8.（可选）安装预打包 Agent** — 侧栏 → **Agent 商店**

从配置好的注册源浏览并安装 Agent。每个安装包内含模型选择、系统提示词、技能与 MCP 服务器配置，一键导入即用。可在 **设置** 中添加自定义注册源 URL。

---

### 添加 MCP 工具

侧栏 → **MCP** → 新建

添加工具服务器：
- **stdio** — 填写命令和参数（如 `npx -y some-mcp-package`）
- **sse** — 填写远程 URL 和可选请求头

支持全局共享服务器和 Agent 级别独立配置，故障自动重启。然后打开 Agent 编辑页 → MCP 标签页挂载所需服务器。

---

### 管理技能

侧栏 → **技能**

技能文件（Markdown 格式）存储在 `~/.sbot/skills/`，可在技能页面从 Clawhub、skills.sh、skillhub.cn 等远程平台搜索并安装，也可手动放入文件夹。在 Agent 编辑页 → 技能标签页中选择要加载的技能，不选则全部加载。

---

### 自定义提示词

侧栏 → **提示词**

查看和编辑任意内置提示词（系统提示、Agent 提示、工具描述等），保存后存储在 `~/.sbot/prompts/` 并覆盖默认值，立即生效无需重启。支持 `{varName}` 占位符，运行时自动替换。

---

### 心跳唤醒（主动激活）

侧栏 → **心跳**

为 Agent 配置周期性提示词，按固定间隔自动唤醒——适合监控、每日汇总、定时主动推送等场景。每条心跳指向具体的渠道或会话并执行一段提示词模板。一次性任务可结合调度器工具使用。

---

### 渠道配置

在 **渠道 → 新建** 中选择类型，填写凭据，再分配 Agent + Saver + Memory。每个用户/群聊的会话自动隔离。

| 类型 | 必填字段 |
|------|---------|
| Lark / 飞书 | App ID、App Secret |
| Slack | Bot Token（`xoxb-...`）、App Token（`xapp-...`）|
| 企业微信 WeCom | Bot ID、Secret |
| 微信 WeChat | 扫码登录（自动获取凭据） |
| 钉钉 DingTalk | Client ID、Client Secret（即 AppKey / AppSecret，Stream 模式） |
| QQ | App ID、Client Secret（QQ 开放平台官方机器人，WebSocket Gateway） |
| OneBot | WS 端口（默认 6700）、可选 Access Token，反向 WebSocket，对接 NapCat / go-cqhttp 等 |

**配置飞书 / Lark：**
1. 在[飞书开放平台](https://open.feishu.cn)（国际版用 [Lark Developer Console](https://open.larksuite.com/)）创建自建应用
2. 开启**机器人**能力
3. 在 **权限管理** 中开通以下权限（也可在 **批量开通** 中导入下方 JSON）：

| 权限 | 说明 |
|------|------|
| `im:message:send_as_bot` | 以机器人身份发送消息 |
| `im:message.p2p_msg:readonly` | 接收私聊消息 |
| `im:message.group_at_msg:readonly` | 接收群聊 @机器人 消息 |
| `im:message.group_msg` | 接收群聊所有消息 |
| `im:message:readonly` | 读取消息内容 |
| `im:chat:readonly` | 读取群信息 |
| `im:resource` | 读取消息中的文件和图片 |
| `contact:user.base:readonly` | 读取用户基本信息 |
| `contact:contact.base:readonly` | 读取通讯录基本信息 |

<details>
<summary>批量导入 JSON</summary>

```json
{
  "scopes": {
    "tenant": [
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "im:chat:readonly",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:resource"
    ],
    "user": []
  }
}
```

</details>

4. 在 **事件与回调** 中将订阅方式设置为**长连接**
5. 在 Web UI → **渠道** 中创建 Lark 渠道，填入 **App ID** 和 **App Secret**

支持事件去重、互动卡片、多用户上下文隔离，以及文件和图片的收发。

**配置企业微信 / WeCom：**
1. 在[企业微信管理后台](https://work.weixin.qq.com)创建智能应用，获取 **Bot ID** 和 **Secret**
2. 在 Web UI → **渠道** 中创建 WeCom 渠道，填入 Bot ID 和 Secret

通过 WebSocket 实时接收和回复消息，支持文件和图片收发。

**配置微信 / WeChat：**
1. 在 Web UI → **渠道** 中创建 WeChat 渠道
2. 点击扫码登录，使用微信扫描二维码完成认证
3. 认证成功后凭据自动保存，渠道即刻上线

微信渠道基于 iLink Bot API 接入，支持文件和图片的收发。

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
- 媒体文件读取（图片等）
- 支持按 Agent 启用只读模式

**归档工具**
- 压缩与解压归档文件
- 列举归档内容
- 直接读取归档内部文件

**Web 工具**
- 抓取网页 URL 并转换为干净的 Markdown
- 从网络下载文件

**调度器**
- 标准 6 字段 Cron 表达式（秒 分 时 日 月 周），服务重启后任务自动恢复
- 任务可指向渠道用户、Web 会话或工作目录
- 可设置最大执行次数，到达上限后自动清理
- 可通过 Web UI 管理，也可直接让 Agent 创建定时任务

**待办事项**
- 后置提取器自动从对话中识别待办，并按需执行 `create` / `patch` / `done` / `delete` 操作
- Agent 可通过 `todo_list` 工具查询当前待办（只读）
- Web UI 提供 Todo 管理页面

**Ask（交互提问）**
- Agent 在执行过程中可随时暂停并向用户提问
- 支持三种问题类型：单选、多选、文本输入
- 支持 Web UI 和飞书；用户回答后 Agent 自动继续执行

---

## 关键词

`AI Agent` `自托管` `大模型服务` `开源` `MCP` `ACP` `模型上下文协议` `多智能体` `ReAct` `OpenAI` `Claude` `Gemini` `Ollama` `聊天机器人` `飞书` `Lark` `OneBot` `QQ` `长期记忆` `向量检索` `TypeScript` `Node.js`
