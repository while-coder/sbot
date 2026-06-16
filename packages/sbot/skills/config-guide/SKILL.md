---
name: config-guide
description: 当用户或 Agent 想读、改、新增 sbot 的配置（model / embedding / saver / note / wiki / channel / agent / mcp / skill / profile / tunnel / 通用 settings），或想了解 ~/.sbot/ 目录里某个文件归属和字段含义时使用。仅在涉及"配置"时触发，单纯查看会话/聊天/日志时不要触发。
---

# sbot 配置指南

sbot 的运行时配置全部落在用户目录 `~/.sbot/`。本 skill 把这套目录、字段含义、修改入口与禁区一次讲清，避免直接 Edit/Write 误伤。

## 1. 目录速览

```
~/.sbot/
├── settings.json                  # 全局配置
├── settings.json.example          # 示例配置，每次启动会被覆盖，不要写入
├── mcp.json                       # 全局 MCP 服务器
├── agents/<id>/                   # 每个 Agent 一个目录，<id> 是路径合法名（不是 UUID）
│   ├── agent.json                 # Agent 配置（不含 systemPrompt）
│   ├── system-prompt.md           # systemPrompt 单独成文件（ACP 模式没有）
│   ├── .store.json                # AgentStore 安装来源（手改会被覆盖）
│   ├── mcp.json                   # 该 Agent 专属 MCP
│   ├── skills/                    # 该 Agent 专属 skills
│   └── insights/                  # Agent 维度的经验洞察
├── skills/                        # 全局 skills（Agent 通过 skills 字段筛选可见性）
├── savers/<saverId>/              # Saver 历史数据
├── notes/<noteId>.db              # 笔记向量库（SQLite + embedding）
├── wiki/<wikiId>/                 # Wiki 数据
└── profiles/<profileId>/
    ├── insights/                  # Profile 维度洞察
    └── todos.json                 # 抽取出的 todo 列表
```

## 2. settings.json

字段必须在白名单内，未列出的字段会在加载时被静默删除并回写。允许的字段：

| 字段                     | 类型                                  | 说明                                             |
| ------------------------ | ------------------------------------- | ------------------------------------------------ |
| `httpPort`               | number                                | HTTP 端口，默认 5500                             |
| `httpUrl`                | string                                | 对外根 URL，默认 `http://localhost:<port>`       |
| `autoApproveTools`       | string[]                              | 全局免确认工具名                                 |
| `autoApproveAllTools`    | boolean                               | 全局免确认所有工具（慎开）                       |
| `startupCommands`        | string[]                              | 启动后顺序同步执行的命令                         |
| `checkUpdateTime`        | number                                | 下次检查更新的时间戳，由系统维护，不要手填       |
| `maxImageSize`           | number                                | 图片 max(w,h) 像素阈值，超过则按比例缩放         |
| `models`                 | `Record<UUID, ModelConfig>`           | key 是 UUID，value 含 provider/apiKey/baseURL/model/name |
| `embeddings`             | `Record<UUID, EmbeddingConfig>`       | 同上，用于笔记向量化                             |
| `savers`                 | `Record<UUID, SaverConfig>`           | `{ name, type: "file" \| "sqlite" \| "memory" }` |
| `notes`                  | `Record<UUID, NoteConfig>`            | `{ name, embedding: <embeddingUUID> }`           |
| `wikis`                  | `Record<UUID, WikiConfig>`            | `{ name, embedding?: <embeddingUUID> }`          |
| `channels`               | `Record<channelId, ChannelConfig>`    | key 是 channelId（不是 UUID），含 type/config/agent/saver/notes |
| `plugins`                | string[]                              | 插件路径或包名                                   |
| `agentSources`           | `{ url, name? }[]`                    | Agent 商店源列表                                 |
| `tunnel`                 | `TunnelConfig[]`                      | 隧道列表，按 `id` 唯一                           |

> `models` / `embeddings` / `savers` / `notes` / `wikis` 的 key 必须是 UUID（创建走 API 时由后端自动分配）。手填非 UUID 不会报错但会让前端识别异常。

## 3. Agent 配置（`agents/<id>/`）

`<id>` 是路径合法名：非空、不含 `<>:"/\|?*` 和空白、首尾不是 `-_.`。

`agent.json` 的字段取决于 `type`，共四种模式：

| 字段                | Single | ReAct | Generative | ACP | 说明                                       |
| ------------------- | :----: | :---: | :--------: | :-: | ------------------------------------------ |
| `name`              |   ✓    |   ✓   |     ✓      |  ✓  | 显示名                                     |
| `type`              |   ✓    |   ✓   |     ✓      |  ✓  | `single` / `react` / `generative` / `acp`  |
| `tags`              |   ✓    |   ✓   |     ✓      |  ✓  | 分类标签                                   |
| `autoApproveTools`  |   ✓    |   ✓   |     ✓      |  ✓  | 该 Agent 免确认工具                        |
| `autoApproveAllTools`|  ✓    |   ✓   |     ✓      |  ✓  | 该 Agent 免确认所有工具                    |
| `model`             |   ✓    |   ✓   |     ✓      |     | 模型 UUID（ReAct 是 Think 编排模型）       |
| `compactModel`      |   ✓    |   ✓   |            |     | 对话压缩模型 UUID                          |
| `mcp`               |   ✓    |   ✓   |            |     | `string[]` 或 `'*'`                        |
| `mcpExclude`        |   ✓    |   ✓   |            |     | `mcp='*'` 时的排除名单                     |
| `mcpParams`         |   ✓    |   ✓   |            |     | 按 provider 分组的运行时参数               |
| `skills`            |   ✓    |   ✓   |            |     | `string[]`（skill 名）或 `'*'`             |
| `insight`           |   ✓    |   ✓   |            |     | `InsightConfig` 必填                       |
| `todo`              |   ✓    |   ✓   |            |     | 不设置=不启用                              |
| `modelCallTimeout`  |   ✓    |   ✓   |            |     | 单次模型调用秒数，<=0 视为不超时           |
| `agents`            |        |   ✓   |            |     | 子 Agent 引用列表 `{ id, name?, desc }[]`  |
| `maxHistoryRounds`  |        |       |     ✓      |     | 滑动窗口轮数，默认 5                       |
| `command` / `args` / `env` |  |       |            |  ✓  | 启动外部 ACP 进程的参数                    |
| `sessionMode`       |        |       |            |  ✓  | ACP 会话模式                               |
| `initTimeout`       |        |       |            |  ✓  | ACP 进程初始化超时秒数                     |

**`systemPrompt` 不在 `agent.json` 里**：保存时会被拆出来写到同目录的 `system-prompt.md`，加载时再合回去（ACP 模式跳过）。要改 prompt 就改 `system-prompt.md`，**不要**塞回 `agent.json`，下次保存会被覆盖。

`.store.json` 是 AgentStore 安装来源元数据 `{ url, version?, installedAt, updatedAt? }`，由 AgentStore 流程维护，**手改会被覆盖**。

## 4. MCP 配置

两种格式都被接受：
```json
{ "mcpServers": { "<uuid>": { ... } } }
```
或直接对象 `{ "<uuid>": { ... } }`。

- 全局：`~/.sbot/mcp.json`
- 单 Agent：`~/.sbot/agents/<id>/mcp.json`

Agent 通过 `agent.json.mcp` 字段从全局集合里挑选启用项（`'*'` = 全选，`mcpExclude` 在 `'*'` 时生效）；专属 mcp.json 里的服务器对该 Agent 始终可见。

## 5. 修改配置：用 HTTP API，不要直接写文件

后端 API 会做字段校验、自动分配 UUID、必要时刷新缓存与重载频道。

| 操作                          | 路由                                                        | 备注 |
| ----------------------------- | ----------------------------------------------------------- | ---- |
| 读取全部 settings + agents 列表| `GET /api/settings`                                         |      |
| 改通用项                      | `PUT /api/settings/general`                                 | 仅限 httpPort/httpUrl/maxImageSize/autoApprove*/startupCommands |
| 列模型 provider 的可用模型 ID | `POST /api/models/available`                                | 用于挑选 `model` 字段值 |
| Models / Embeddings / Savers / Notes / Wikis | `POST\|PUT\|DELETE /api/settings/{section}/:id` | UUID 由 POST 自动生成 |
| Channels                      | `POST\|PUT\|DELETE /api/settings/channels/:id`              | save/delete 后会自动重载频道 |
| Agent                         | `GET /api/agents`、`POST /api/agents`、`GET\|PUT\|DELETE /api/agents/:id` | POST 时 `id` 必填且需通过路径合法性校验 |
| 全局 MCP                      | `GET\|POST\|PUT\|DELETE /api/mcp[/:id]`                     | 改动后会刷新工具缓存 |
| MCP 详情（工具/Prompt/资源）  | `GET /api/mcp/:id/details`                                  |      |
| Agent MCP                     | `GET\|POST\|PUT\|DELETE /api/agents/:name/mcp[/:id]`        |      |
| 全局 Skills                   | `GET /api/skills`、`DELETE /api/skills/:name`               | 改动后会刷新 skill 缓存 |
| Agent Skills                  | `GET /api/agents/:name/skills`、`PUT\|DELETE /api/agents/:name/skills/:skillName` | PUT body 必须含 `content` |
| Web Profiles                  | `GET /api/profiles`、`POST\|PUT\|DELETE /api/settings/profiles[/:id]` |      |

### 不要直接 Edit/Write 这些 JSON

三个理由：
1. settings.json 有字段白名单，未列出的字段会被静默清掉。
2. 文件改了之后 sbot 进程的内存缓存还是旧值，频道、MCP、skills 各自还有自己的缓存，不调对应 API 不会重载。
3. UUID key 容易写重或写错，没有后端校验。

## 6. 常见任务范例

**新增一个 OpenAI 模型**
```http
POST /api/settings/models
Content-Type: application/json

{
  "name": "gpt-4o",
  "provider": "openai",
  "apiKey": "sk-...",
  "baseURL": "https://api.openai.com/v1",
  "model": "gpt-4o"
}
```
后端会自动分配 UUID 并探测 context window。

**给某个 Agent 加一个 MCP server（专属）**
```http
POST /api/agents/<agentId>/mcp
Content-Type: application/json

{ "name": "my-fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"] }
```

**改 Agent 的 system prompt** — 走 `PUT /api/agents/:id`，把 `systemPrompt` 字段放在 body 里，后端会拆到 `system-prompt.md`。

**新建一个 Web profile**
```http
POST /api/settings/profiles
Content-Type: application/json

{ "name": "demo", "agent": "<agentId>", "saver": "<saverUUID>", "notes": [] }
```

## 7. 危险禁区

- **内置 Web Channel** 不能删；系统会自动补回，删了也是白删。
- **`checkUpdateTime`** 由系统维护，手工置 0 等于强制立即检查更新，不是 bug。
- **`apiKey` / `cloudflareToken`** 不要回显到聊天、日志、PR 描述。读取后做掩码再展示。
- **`.store.json`** 是 AgentStore 安装记录，手改会被下一次 pull/update 覆盖；要解绑就删整个 Agent 目录后重新 `POST /api/agents`。
- **`settings.json.example`** 每次进程启动都会被覆盖，写它没意义。
- **直接 Edit `agent.json`** 添加 `systemPrompt` 字段会被下次保存拆掉，永远只有 `system-prompt.md` 是 prompt 真源。

## 8. 故障排查

| 现象                                     | 原因                                                   |
| ---------------------------------------- | ------------------------------------------------------ |
| 写到 settings.json 的字段重启后消失       | 不在白名单内，加载时被清掉                             |
| 改了 settings.json 但进程行为没变         | 没走 API，进程内的 settings 缓存仍是旧值               |
| 创建 Agent 报 "Invalid id"                | id 为空、含路径非法字符/空白，或首尾是 `-_.`           |
| `getAgent` 报 "not found"                | `<id>/agent.json` 不存在                               |
| Agent 启动后 `systemPrompt` 是空的        | `system-prompt.md` 缺失或被误塞回 `agent.json`         |
| MCP 改了但 Agent 工具列表没刷新           | 走的不是 API，工具缓存没刷新                           |
| `notes` 配置存了但向量搜索报 embedding 错 | `embedding` 字段写的不是 `embeddings` 中真实的 UUID    |
| Web channel 怎么也删不掉                  | 系统会自动补回，按设计如此                             |
