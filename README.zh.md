# sbot — 自托管 AI Agent 服务

[English](https://github.com/while-coder/sbot/blob/main/README.md) | **中文**

[![npm version](https://img.shields.io/npm/v/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![npm downloads](https://img.shields.io/npm/dm/@qingfeng346/sbot)](https://www.npmjs.com/package/@qingfeng346/sbot)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**开源、自托管的 AI Agent 框架。** 模块化配置：模型、记忆、工具、渠道均可独立组合，按需搭建 Agent —— 在自己的服务器上运行，支持多渠道接入、MCP 工具协议和内置 Web UI，无供应商绑定。

📖 **[完整文档 →](https://while-coder.github.io/sbot/zh/)**

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
| `sbot update` | 更新到最新版本（若服务运行中会先停止） |
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
- **记忆（Memory）** — Agent 级自动长期记忆：会话空闲后由后台 MemoryLLM 提炼持久知识，主 Agent 通过 `search_memory` / `read_memory` 召回，并有 consolidate / reconcile 维护任务
- **日程（Agenda）** — 由对话驱动的提醒、日程与周期任务，支持 absolute / interval / cron 触发器；可每轮对话后从对话自动同步，并投递到任意会话或渠道
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

## 文档

完整使用指南（含分步配置与各功能详解）见
**[while-coder.github.io/sbot](https://while-coder.github.io/sbot/zh/)**：

- **快速上手** — [快速开始](https://while-coder.github.io/sbot/zh/guide/getting-started) · [核心特性](https://while-coder.github.io/sbot/zh/guide/features)
- **模型与 Agent** — [模型](https://while-coder.github.io/sbot/zh/guide/models) · [Agent](https://while-coder.github.io/sbot/zh/guide/agents) · [Agent 商店](https://while-coder.github.io/sbot/zh/guide/agent-store)
- **存储与知识** — [存储](https://while-coder.github.io/sbot/zh/guide/savers) · [笔记](https://while-coder.github.io/sbot/zh/guide/note) · [知识库](https://while-coder.github.io/sbot/zh/guide/wiki)
- **自动化** — [记忆](https://while-coder.github.io/sbot/zh/guide/memory) · [日程](https://while-coder.github.io/sbot/zh/guide/agenda) · [心跳唤醒](https://while-coder.github.io/sbot/zh/guide/heartbeat)
- **工具与技能** — [内置工具](https://while-coder.github.io/sbot/zh/guide/tools) · [MCP 工具](https://while-coder.github.io/sbot/zh/guide/mcp) · [技能](https://while-coder.github.io/sbot/zh/guide/skills)
- **渠道** — [渠道配置](https://while-coder.github.io/sbot/zh/guide/channels)（飞书/Lark · Slack · 企业微信 · 微信 · 钉钉 · QQ · OneBot · 小爱）

---

## 关键词

`AI Agent` `自托管` `大模型服务` `开源` `MCP` `ACP` `模型上下文协议` `多智能体` `ReAct` `OpenAI` `Claude` `Gemini` `Ollama` `聊天机器人` `飞书` `Lark` `OneBot` `QQ` `长期记忆` `向量检索` `TypeScript` `Node.js`
