# ChatView 统一化设计 — chat-ui 全量下沉

**日期**: 2026-04-29  
**状态**: 设计完成，待实施

## 目标

将 website 的全部聊天功能下沉到 `@sbot/chat-ui` 的 `ChatView.vue`，使 website、PWA、VSCode Extension 三个平台共用同一个完整的聊天界面组件，布局完全统一，仅通过 CSS 主题文件区分视觉风格。

## 布局结构

```
┌──────────────────────────────────────────────────┐
│ ChatView                                         │
│ ┌────────────┬──────────────────────────────────┐│
│ │ SessionBar │  ┌─ ConfigToolbar ─────────────┐ ││
│ │            │  │ Agent | Saver | WorkDir |    │ ││
│ │ [sessions] │  │ Memory | Wiki | AutoApprove │ ││
│ │            │  ├─ StatusBar ─────────────────┤ ││
│ │            │  │ CtxWindow | Usage | ⟳ | 🗑  │ ││
│ │ [+ new]    │  ├─ ChatArea ─────────────────┤ ││
│ │            │  │ MessageList                 │ ││
│ │            │  │ (tool approval bar)         │ ││
│ │            │  │ (ask form)                  │ ││
│ │            │  │ (queued messages)           │ ││
│ │            │  ├─ StopBar ──────────────────┤ ││
│ │            │  ├─ InputBar ─────────────────┤ ││
│ │            │  │ Attachments + RichInput     │ ││
│ │            │  │ + Send + Attach buttons     │ ││
│ └────────────┴──┴────────────────────────────┘ ││
└──────────────────────────────────────────────────┘
```

## 组件清单

### 新增组件

| 组件 | 文件 | 说明 |
|------|------|------|
| SessionBar | `SessionBar.vue` | 左侧 session 列表、新建/删除/重命名 |
| NewSessionModal | `NewSessionModal.vue` | 新建 session 模态框 (agent + saver + memory + wiki) |
| ConfigToolbar | `ConfigToolbar.vue` | 第一行配置栏：Agent、Saver、WorkDir、Memory、Wiki、AutoApprove |
| StatusBar | `StatusBar.vue` | 第二行状态栏：context window %、last/total usage、刷新、清除历史 |
| PathPickerModal | `PathPickerModal.vue` | 目录浏览器模态框，通过 transport 获取目录列表 |
| MultiSelect | `MultiSelect.vue` | 通用多选下拉组件（memory、wiki 用） |
| ChatArea | `ChatArea.vue` | 消息区域容器，管理 streaming、tool approval、ask forms、queued messages |
| ToolApprovalBar | `ToolApprovalBar.vue` | 工具调用审批栏（approve/deny + 倒计时） |
| AskForm | `AskForm.vue` | 用户输入表单（radio/checkbox/text + 倒计时） |

### 保留组件（现有）

| 组件 | 变化 |
|------|------|
| MessageList.vue | 微调：增加 queued messages 显示支持 |
| MessageItem.vue | 保持不变 |
| RichInput.vue | 保持不变 |
| ThinkDrawer.vue | 保持不变 |
| ImageLightbox.vue | 保持不变 |

### 废弃组件

| 组件 | 替代 |
|------|------|
| ChatApp.vue | 被新 ChatView 取代 |
| SessionPicker.vue | 功能合并到 SessionBar |
| ServerPicker.vue | 保留但移到外层使用（不在 ChatView 内） |

## IChatTransport 接口（扩展）

```typescript
interface IChatTransport {
  // ── 连接管理 ──
  connect(): void
  disconnect(): void
  onEvent(handler: (event: ChatEvent) => void): void
  offEvent(handler: (event: ChatEvent) => void): void

  // ── Session 管理 ──
  listSessions(): Promise<SessionItem[]>
  createSession(opts: CreateSessionOpts): Promise<string>
  deleteSession(sessionId: string): Promise<void>
  updateSession(sessionId: string, patch: Partial<SessionItem>): Promise<void>
  selectSession(sessionId: string): void

  // ── 消息 ──
  sendMessage(sessionId: string, parts: ContentPart[], attachments?: Attachment[]): void
  getHistory(sessionId: string): Promise<StoredMessage[]>
  clearHistory(sessionId: string): Promise<void>

  // ── Token 用量 ──
  getUsage(sessionId: string): Promise<UsageInfo>

  // ── 工具审批 / Ask ──
  approveToolCall(approval: ToolApprovalPayload): void
  answerAsk(answer: AskAnswerPayload): void
  abort(): void

  // ── 配置 ──
  getSettings(): Promise<AppSettings>
  updateSessionConfig(sessionId: string, field: string, value: any): Promise<void>
  getSessionStatus(sessionId: string): Promise<SessionStatus>

  // ── 文件系统 ──
  listDir(path: string): Promise<DirEntry[]>
  quickDirs(): Promise<string[]>
  mkdir(path: string): Promise<void>

  // ── Thinks ──
  getThinksUrlPrefix(sessionId: string): string
  fetchThinks?(url: string): Promise<any>
}
```

### ChatEvent 类型

```typescript
type ChatEvent =
  | { type: 'connectionStatus'; online: boolean }
  | { type: 'stream'; content: string | any[] }
  | { type: 'message'; data: StoredMessage }
  | { type: 'toolCall'; data: ToolCallEvent }
  | { type: 'ask'; data: AskEvent }
  | { type: 'queue'; messages: QueuedMessage[] }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'usage'; data: UsageData }
```

## 新增类型

```typescript
// ── Token 用量 ──
interface UsageInfo {
  last?: { input: number; output: number }
  total?: { input: number; output: number }
  contextWindow?: number
  contextUsed?: number
}

interface UsageData {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

// ── Session 扩展 ──
interface CreateSessionOpts {
  agent: string
  saver: string
  memories?: string[]
  wikis?: string[]
  name?: string
}

interface SessionItem {
  id: string
  name?: string
  agent: string
  saver: string
  memories: string[]
  wikis?: string[]
  workPath?: string
  autoApprove?: boolean
}

// ── 工具审批 ──
interface ToolCallEvent {
  id: string
  name: string
  args: unknown
  sessionId: string
}

type ToolApprovalType = 'allow' | 'alwaysArgs' | 'alwaysTool' | 'deny'

interface ToolApprovalPayload {
  callId: string
  approval: ToolApprovalType
}

// ── Ask 表单 ──
interface AskQuestion {
  key: string
  label: string
  type: 'radio' | 'checkbox' | 'text'
  options?: string[]
  allowCustom?: boolean
}

interface AskEvent {
  id: string
  questions: AskQuestion[]
  timeout?: number
  sessionId: string
}

interface AskAnswerPayload {
  askId: string
  answers: Record<string, string | string[]>
}

// ── 文件系统 ──
interface DirEntry {
  name: string
  isDir: boolean
}

// ── App settings ──
interface WikiOption { id: string; name: string }

interface AppSettings {
  agents: Record<string, { name?: string }>
  savers: Record<string, { name: string }>
  memories: Record<string, { name: string }>
  wikis: Record<string, { name: string }>
}

// ── Session status (pending state) ──
interface SessionStatus {
  pendingToolCall?: ToolCallEvent
  pendingAsk?: AskEvent
  queuedMessages?: QueuedMessage[]
}

interface QueuedMessage {
  content: string | any[]
}
```

## ChatView Props

```typescript
interface ChatViewProps {
  transport: IChatTransport
  labels?: ChatLabels
  showAttachments?: boolean
}
```

外层只需提供一个 transport 实例。ChatView 内部通过 transport 获取所有数据、执行所有操作。

## 主题文件

```
chat-ui/src/themes/
  variables.css        // 所有 CSS 变量声明 + 合理默认值
  theme-web.css        // website 覆盖（亮色、网页风格）
  theme-vscode.css     // VSCode 覆盖（映射 --vscode-* 变量）
  theme-pwa.css        // PWA 覆盖（移动端优化间距）
```

使用方式：
```typescript
// website
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-web.css'

// vscode
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-vscode.css'
```

### CSS 变量命名规范

所有变量统一 `--chatui-` 前缀：

- 颜色：`--chatui-bg`, `--chatui-bg-surface`, `--chatui-fg`, `--chatui-fg-secondary`, `--chatui-border`, `--chatui-accent`
- 字体：`--chatui-font-family`, `--chatui-font-size`, `--chatui-font-size-sm`
- 间距：`--chatui-spacing-xs`, `--chatui-spacing-sm`, `--chatui-spacing-md`
- 圆角：`--chatui-radius-sm`, `--chatui-radius-md`
- 按钮：`--chatui-btn-bg`, `--chatui-btn-fg`, `--chatui-btn-hover`

## 各平台使用方式

### Website

```vue
<!-- App.vue or ChatPage.vue -->
<template>
  <ChatView :transport="transport" />
</template>

<script setup>
import { ChatView } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-web.css'
import { createWebSocketTransport } from './transport'

const transport = createWebSocketTransport()
</script>
```

### PWA

```vue
<template>
  <ChatView :transport="transport" />
</template>

<script setup>
import { ChatView } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-pwa.css'
import { createWebSocketTransport } from './transport'

const transport = createWebSocketTransport()
</script>
```

### VSCode Extension

```vue
<template>
  <ChatView :transport="transport" />
</template>

<script setup>
import { ChatView } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-vscode.css'
import { createVSCodeTransport } from './transport'

const transport = createVSCodeTransport()
</script>
```

## 数据流

```
ChatView
  ├─ onMounted: transport.getSettings() → 填充 agents/savers/memories/wikis 选项
  ├─ onMounted: transport.listSessions() → 填充 session 列表
  ├─ onMounted: transport.connect() + onEvent(handler)
  │
  ├─ SessionBar 点击 session → transport.selectSession(id) + getHistory(id) + getUsage(id)
  ├─ SessionBar 新建 → NewSessionModal → transport.createSession(opts)
  ├─ SessionBar 删除 → confirm → transport.deleteSession(id)
  ├─ SessionBar 重命名 → transport.updateSession(id, { name })
  │
  ├─ ConfigToolbar 改配置 → transport.updateSessionConfig(sessionId, field, value)
  ├─ ConfigToolbar 选路径 → PathPickerModal → transport.listDir/mkdir/quickDirs
  │
  ├─ StatusBar 刷新 → transport.getHistory(id) + getUsage(id)
  ├─ StatusBar 清除 → confirm → transport.clearHistory(id)
  │
  ├─ ChatArea 收到 stream event → 更新 streamingContent
  ├─ ChatArea 收到 message event → push to messages
  ├─ ChatArea 收到 toolCall event → 显示 ToolApprovalBar
  ├─ ChatArea 收到 ask event → 显示 AskForm
  ├─ ChatArea 收到 usage event → 更新 usage 显示
  │
  ├─ InputBar 发送 → transport.sendMessage(sessionId, parts, attachments)
  ├─ StopBar 取消 → transport.abort()
  ├─ ToolApprovalBar 审批 → transport.approveToolCall(payload)
  └─ AskForm 提交 → transport.answerAsk(payload)
```

## 不在 ChatView 范围内的功能

以下功能保留在各平台外层：

- 服务器选择（ServerPicker）— 连接前的步骤，不属于聊天界面
- 全局 Token 用量统计页面 — 独立页面，不属于聊天界面
- 导航路由 — 各平台有不同路由方案
- Settings/Agents/Savers 等管理页面 — 独立页面

## 迁移策略

1. 先在 chat-ui 中实现所有新组件和扩展后的 IChatTransport
2. 为 website 实现 WebSocketTransport（IChatTransport 的 WS 实现）
3. 将 website 的 ChatView 替换为 chat-ui 的 ChatView
4. 验证 website 功能完整
5. 适配 PWA
6. 适配 VSCode Extension
