---
name: config-guide
description: "用于查看、解释、新增或修改 sbot 运行时配置时使用，覆盖 ~/.sbot 下的 settings、models、embeddings、savers、notes、wikis、memoryProfiles、agendaProfiles、channels、agents、MCP、skills、agent store、profiles、tunnel、plugins，以及配置字段归属和安全修改路径。仅在问题涉及 sbot 配置、配置文件、配置 API 或配置目录时触发；单纯查看聊天、会话内容、日志或实现细节时不要触发。"
---

# sbot 配置指南

把这个 skill 当成 sbot 配置的操作手册：先判断配置归属，再走对应 API 修改，最后验证运行时已刷新。不要把它当成完整 schema 文档；字段细节以运行时 API 和 `~/.sbot` 中的实际配置为准。

## 核心规则

1. 优先用 HTTP API 读写配置。API 会做字段清洗、分配 UUID、刷新缓存或重载运行实例。
2. 只在排查、迁移、sbot 未启动、或用户明确要求直接改文件时写 `~/.sbot` 下的 JSON/Markdown；写完要说明可能需要重启或触发 reload。
3. 读取配置时掩码展示 `apiKey`、`cloudflareToken`、headers 里的 token、MCP env 中的 secret 等敏感值。
4. 改配置前先 `GET /api/settings` 或读对应 API，确认现有 id 和引用关系；不要凭名字猜 UUID。
5. 改完至少验证一次：重新 GET 对应 API，或确认相关缓存/服务状态已更新。

## 运行目录

sbot 运行时配置目录是 `~/.sbot/`。处理配置问题时只需要围绕这个目录和对应 HTTP API 判断归属。

常见落点：

| 路径 | 归属 |
| --- | --- |
| `settings.json` | 全局配置白名单字段 |
| `settings.json.example` | 启动时覆盖生成的示例，不要改 |
| `mcp.json` | 全局 MCP，保存格式固定为 `{ "mcpServers": ... }` |
| `agents/<id>/agent.json` | Agent 配置主体，不含 `systemPrompt` |
| `agents/<id>/system-prompt.md` | 非 ACP Agent 的真实 system prompt |
| `agents/<id>/.store.json` | AgentStore 安装来源，普通配置修改不要手写 |
| `agents/<id>/mcp.json` | Agent 专属 MCP |
| `agents/<id>/skills/` | Agent 专属 skills |
| `skills/` | 用户全局 skills |
| `savers/<saverId>/` | saver 历史数据 |
| `notes/<noteId>.db` / `notes/<noteId>/` | note SQLite 与检索缓存 |
| `wiki/<wikiId>/` | wiki 数据 |
| `memories/<memoryId>/` | memoryProfile 的长期记忆数据 |
| `agendas/<agendaId>/agenda.db` | agendaProfile 的事项数据 |
| `profiles/<threadId>/settings.json` | SessionService 的线程级设置，不等同于 Web profile 管理配置 |
| `database.sqlite` | channel session、session_profile、usage 等数据库表 |
| `plugins/` | 本地 channel plugin 扫描目录 |
| `prompts/` | 用户覆盖 prompt 的目录 |

## settings.json

`settings.json` 加载时只保留白名单字段；多余字段会被删除并回写。白名单：

`httpPort`, `httpUrl`, `autoApproveTools`, `autoApproveAllTools`, `startupCommands`, `checkUpdateTime`, `maxImageSize`, `contextFileNames`, `models`, `embeddings`, `savers`, `notes`, `wikis`, `memoryProfiles`, `agendaProfiles`, `channels`, `plugins`, `agentSources`, `tunnel`

先用 `GET /api/settings` 读取总览；响应会包含 settings 和从 `agents/` 目录动态注入的 Agent 列表。挑选模型 ID 时用 `POST /api/models/available`，不要只靠记忆填写 provider 的模型名。

常用字段：

| 字段 | 说明 | 首选修改入口 |
| --- | --- | --- |
| `httpPort`, `httpUrl` | HTTP 监听端口和对外根 URL | `PUT /api/settings/general` |
| `maxImageSize` | 图片缩放阈值，按 max(width,height) 判断 | `PUT /api/settings/general` |
| `autoApproveTools`, `autoApproveAllTools` | 全局工具自动批准 | `PUT /api/settings/general` |
| `startupCommands` | 启动后顺序同步执行的命令 | `PUT /api/settings/general` |
| `contextFileNames` | workPath 向上扫描的上下文文件优先级；为空/未设时默认 `SBOT.md`, `AGENTS.md`，大小写不敏感 | `PUT /api/settings/general` |
| `models` | `Record<UUID, ModelConfig>`，模型配置 | `/api/settings/models` |
| `embeddings` | `Record<UUID, EmbeddingConfig>`，note/wiki 检索可用 | `/api/settings/embeddings` |
| `savers` | `Record<UUID, { name, type }>`，`type=file/sqlite/memory` | `/api/settings/savers` |
| `notes` | `Record<UUID, { name, embedding? }>`；无 embedding 时退化为关键词/时间检索 | `/api/settings/notes` |
| `wikis` | `Record<UUID, { name, embedding? }>` | `/api/settings/wikis` |
| `memoryProfiles` | 长期记忆模板，含 `enabled`, `writerModel`, prompt 文件 | `/api/settings/memoryProfiles` |
| `agendaProfiles` | 事项模板，含 `enabled`, `syncModel`, prompt 文件 | `/api/settings/agendaProfiles` |
| `channels` | channel 默认配置；内置 `web` 固定存在 | `/api/settings/channels` |
| `agentSources` | AgentStore 源列表 | `/api/agent-store/*` |
| `tunnel` | 内网穿透配置数组 | `/api/tunnel/config` |
| `plugins` | 额外 channel plugin 包名或路径；另会扫描 `~/.sbot/plugins/*/index.js` | 通常需改文件或对应 UI |

`models`、`embeddings`、`savers`、`notes`、`wikis`、`memoryProfiles`、`agendaProfiles` 的 key 应是 UUID。`channels` 是 channelId，`POST /api/settings/channels` 会生成 UUID，内置 Web channel 使用固定 id `web`。

## 标准 Settings CRUD

这些 section 使用相同模式：

```http
POST   /api/settings/<section>
PUT    /api/settings/<section>/:id
DELETE /api/settings/<section>/:id
```

适用 section：

`models`, `embeddings`, `savers`, `notes`, `wikis`, `memoryProfiles`, `agendaProfiles`, `channels`

注意：

- `POST` 自动生成 UUID，不要手填 id，除非直接改文件。
- `models` 保存后会异步探测并保存 context window。
- `channels` 保存或删除后会 reload channel；删除 `web` 会被拒绝。
- 删除 `memoryProfiles` 会在无活实例时删除 `memories/<id>/`；有活实例时延迟到 teardown。
- 删除 `agendaProfiles` 会清理 agenda service/store/trigger engine。

## Agent 配置

Agent 不写在 `settings.json`。每个 Agent 是 `~/.sbot/agents/<id>/` 目录：

```text
agents/<id>/
  agent.json
  system-prompt.md
  .store.json
  mcp.json
  skills/
```

`<id>` 必须非空，不含路径非法字符和空白，且首尾不能是 `-`, `_`, `.`。

首选 API：

```http
GET    /api/agents
POST   /api/agents
GET    /api/agents/:id
PUT    /api/agents/:id
DELETE /api/agents/:id
```

字段按模式区分：

| 模式 | 必要/常用字段 |
| --- | --- |
| `single` | `name`, `type`, `model`, `systemPrompt`, `compactModel?`, `mcp?`, `mcpExclude?`, `mcpParams?`, `skills?`, `modelCallTimeout?`, `autoApprove*?`, `tags?` |
| `react` | single 工具字段 + `agents: { id, desc }[]`，其中 `id` 指向其他 Agent |
| `generative` | `name`, `type`, `model`, `systemPrompt?`, `maxHistoryRounds?`, `autoApprove*?`, `tags?` |
| `acp` | `name`, `type`, `command`, `args?`, `env?`, `sessionMode?`, `initTimeout?`, `autoApprove*?`, `tags?` |

`systemPrompt` 是 API 字段，但文件真源是 `system-prompt.md`。保存 Agent 时后端会把 `systemPrompt` 从 `agent.json` 拆出去；直接把 `systemPrompt` 塞进 `agent.json` 会在下次保存时消失。ACP 读取时不合并 prompt。

`.store.json` 是 AgentStore 元数据；除非在修复安装来源，否则不要直接改。

## MCP

全局 MCP 文件：`~/.sbot/mcp.json`。Agent 专属 MCP 文件：`~/.sbot/agents/<id>/mcp.json`。

两种读取格式都兼容：

```json
{ "mcpServers": { "<id>": { "type": "stdio" } } }
```

或直接：

```json
{ "<id>": { "type": "stdio" } }
```

保存时会统一写成 `{ "mcpServers": ... }`。

API：

```http
GET    /api/mcp
POST   /api/mcp
PUT    /api/mcp/:id
DELETE /api/mcp/:id
GET    /api/mcp/:id/details

GET    /api/agents/:name/mcp
POST   /api/agents/:name/mcp
PUT    /api/agents/:name/mcp/:id
DELETE /api/agents/:name/mcp/:id
GET    /api/agents/:name/mcp/:id/details
```

全局 MCP 修改会 `refreshGlobalAgentToolService()`。Agent 专属 MCP 只影响该 Agent。Agent 的 `mcp` 字段从全局集合中筛选：`'*'` 表示全选，`mcpExclude` 只在 `'*'` 时生效；专属 `mcp.json` 对该 Agent 始终可见。

MCP entry 常见字段：`type` (`stdio`/`http`/`sse`), `command`, `args`, `env`, `url`, `headers`, `cwd`, `toolTimeout`, `enablePromptTools`, `enableResourceTools`。

## Skills

全局 skill 可见来源不止 `~/.sbot/skills`。服务会扫描：

- 内置：随 sbot 安装包提供的内置 skills
- Agents：`~/.agents/skills`
- Claude Code：`~/.claude/skills`
- SkillHub：`~/skills`
- 全局：`~/.sbot/skills`

Agent 运行时还会注册：

- `~/.sbot/agents/<id>/skills`
- `<workPath>/.skills`，除非 channel/profile 设置 `disableWorkspaceSkills`

API：

```http
GET    /api/skills
DELETE /api/skills/:name

GET    /api/agents/:name/skills
PUT    /api/agents/:name/skills/:skillName
DELETE /api/agents/:name/skills/:skillName

POST   /api/agents/:agentName/skill-hub/install
POST   /api/agents/:agentName/skill-hub/install-zip
```

`DELETE /api/skills/:name` 只删除 `~/.sbot/skills/<name>`，不会删内置、Agents、Claude Code 或 SkillHub 目录里的同名 skill。`PUT /api/agents/:name/skills/:skillName` 的 body 必须包含 `content`，写入 Agent 专属 `SKILL.md`。

Agent 的 `skills` 字段从全局 skill 集合中筛选：`'*'` 表示全选，数组表示按 skill name 选择。Agent 专属 skills 不依赖这个筛选。

## Channel、Session Profile、Web Profile

`channels` 在 `settings.json` 中保存 channel 默认值。`web` channel 是内置项，缺失时启动会自动补回。

`ChannelConfig` 常用字段：

`name`, `type`, `config`, `agent`, `saver`, `notes`, `wikis`, `workPath`, `streamVerbose`, `autoApproveAllTools`, `disableWorkspaceContext`, `disableWorkspaceSkills`, `approvalTimeout`, `approvalTimeoutValue`, `askTimeout`, `askTimeoutMessage`, `intentModel`, `intentPrompt`, `intentThreshold`, `mergeWindow`, `memory`, `agenda`, `tools`, `triggerTools`

Session profile 不在 `settings.json`。它在 `database.sqlite` 的 `session_profile` 表中，字段值为 `null` 时沿用 channel 默认值。

相关 API：

```http
GET    /api/profiles
POST   /api/settings/profiles
PUT    /api/settings/profiles/:id
DELETE /api/settings/profiles/:id

GET    /api/channel-sessions
PUT    /api/channel-sessions/:id
POST   /api/channel-sessions/:id/clone-profile
POST   /api/channel-sessions/:id/detach-profile
GET    /api/channel-sessions/:id/effective-config

GET    /api/session-profiles
GET    /api/session-profiles/:id
POST   /api/session-profiles
PUT    /api/session-profiles/:id
DELETE /api/session-profiles/:id
```

`/api/settings/profiles` 是 Web 管理界面的兼容入口：创建 Web session 并写一组初始 profile 字段。通用的 visible profile 管理走 `/api/session-profiles`。

## Memory 与 Agenda

配置模板在 `settings.json`：

```http
POST   /api/settings/memoryProfiles
PUT    /api/settings/memoryProfiles/:id
DELETE /api/settings/memoryProfiles/:id

POST   /api/settings/agendaProfiles
PUT    /api/settings/agendaProfiles/:id
DELETE /api/settings/agendaProfiles/:id
```

引用位置：

- `channels.<id>.memory` / `channels.<id>.agenda`
- `session_profile.memory` / `session_profile.agenda`

运行数据：

- memory：`~/.sbot/memories/<memoryId>/`
- agenda：`~/.sbot/agendas/<agendaId>/agenda.db`

`enabled: false` 表示引用可以存在，但运行时不启用。`memoryProfiles.writerModel` 必须指向 `models` 中的 UUID。`agendaProfiles.syncModel` 可选；为空时同步抽取不启用。

Agenda item 管理走：

```http
GET    /api/agendas?agendaId=<id>
POST   /api/agendas
PATCH  /api/agendas/:id
POST   /api/agendas/:id/complete
POST   /api/agendas/:id/cancel
DELETE /api/agendas/:id
```

## Tunnel 与 AgentStore

Tunnel 配置用专门 API，body 是完整数组替换：

```http
GET  /api/tunnel/status
PUT  /api/tunnel/config
POST /api/tunnel/start
POST /api/tunnel/stop
POST /api/tunnel/entries/:id/start
POST /api/tunnel/entries/:id/stop
```

Tunnel `id` 必须匹配 `[A-Za-z0-9_.-]{1,64}`，`type` 是 `cloudflare-quick`、`cloudflare-token` 或 `localtunnel`。不要回显 `cloudflareToken`。

AgentStore 源和安装：

```http
GET  /api/agent-store/list
POST /api/agent-store/add
POST /api/agent-store/remove
POST /api/agent-store/install
GET  /api/agent-store/export?id=<agentId>
```

安装 AgentStore 包会写入 Agent 目录并生成 `.store.json`。

## 直接写文件时的检查清单

仅在 API 不可用或用户明确要求时使用：

1. 先备份或至少读出原文件。
2. 保持 JSON 格式化为 2 空格缩进。
3. 不要新增 `settings.json` 白名单外字段。
4. 新增跨引用时先确认目标存在：model、embedding、saver、note、wiki、memoryProfile、agendaProfile、agent。
5. 改 Agent prompt 时写 `system-prompt.md`，不要写回 `agent.json.systemPrompt`。
6. 改 MCP 后优先调用对应 API 或重启，以刷新工具缓存。
7. 改 channel 后要 reload channel；API 会做，直接改文件不会做。
8. 改 `plugins` 或本地 plugin 后通常需要重启 channel/plugin loader。

## 常见排查

| 现象 | 重点检查 |
| --- | --- |
| `settings.json` 字段重启后消失 | 字段不在白名单 |
| 改了 JSON 但行为没变 | 绕过 API，内存缓存或 channel/MCP/skill 缓存未刷新 |
| 创建 Agent 报 `Invalid id` | id 含空白/路径非法字符，或首尾是 `-_.` |
| Agent prompt 为空 | `system-prompt.md` 缺失，或 ACP 模式不会合并 prompt |
| MCP 工具没刷新 | 全局 MCP 未走 `/api/mcp`，或 Agent 专属 MCP 需要重建对应 Agent |
| note/wiki 语义搜索异常 | `embedding` 指向不存在的 embedding UUID |
| memory/agenda 没启用 | profile 不存在、`enabled=false`，或 model 引用无效 |
| Web channel 删除后又出现 | `ensureWebChannel()` 会自动补回 |
| `checkUpdateTime=0` 后立刻检查更新 | 这是设计行为，0/undefined 表示立即检查 |
