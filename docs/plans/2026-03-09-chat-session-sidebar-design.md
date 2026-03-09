# Chat Session Sidebar Design

**Date:** 2026-03-09
**Topic:** 聊天页面 Session 侧边栏重构

## Goal

重构 ChatView 的 Session 管理：
- 左侧显示 Session 列表，点击切换当前会话并加载对应历史
- 右侧显示当前 Session 的聊天历史记录及输入栏
- 新建会话通过弹窗选择 Agent / 存储 / 记忆，名称自动生成
- 列表项悬停显示删除按钮

## Layout

```
┌──────────────────────────────────────────────────┐
│  工具栏：会话名 | Agent名 | [存储chip] [记忆chip] │
│                               [刷新] [清除历史]   │
├──────────────┬───────────────────────────────────┤
│  左侧(180px) │  右侧：聊天消息区                  │
│  [+ 新建会话]│  (当前会话历史)                    │
│  ───────────  │                                   │
│  · 会话A  🗑  │                                   │
│  · 会话B  🗑  │                                   │
│  ...          │  ─────────────────────────────── │
│               │  输入栏                           │
└──────────────┴───────────────────────────────────┘
```

## New Component: `NewSessionModal.vue`

- Exposed method: `open()`
- Emits: `created(sessionId: string)`
- Form fields:
  - **Agent** (required select)
  - **存储 / Saver** (required select)
  - **记忆 / Memory** (optional select, default: none)
- Session name auto-generated: `YYYY/MM/DD HH:mm`
- On confirm: `POST /api/settings/sessions` with `{ name, agent, saver, memory? }`
- On success: emit `created` with the new session ID

## ChatView.vue Changes

### State removed
- `freeSessionId`
- `currentAgent`, `currentSaver`, `currentMemory`
- `effectiveAgent`, `effectiveSaver`, `effectiveMemory` computed → replaced by direct session lookup

### New behavior
- On mount: if sessions exist, select the first one and load its history
- Session list item click → `switchSession(id)` → update `activeSessionId` → `refreshHistory()`
- Session list item hover → show delete icon → `deleteSession(id)` → `DELETE /api/settings/sessions/:id` → if deleted session was active, switch to first remaining or clear

### Toolbar (simplified)
- Shows: session name, agent label, saver chip (clickable), memory chip (clickable, if set)
- Buttons: 刷新, 清除历史
- No free-mode selectors

### Session sidebar
- Top: `[+ 新建会话]` button → opens `NewSessionModal`
- List: `v-for sessions` — each item shows name + agent label, hover shows delete btn
- Active item has `.active` class

### `ensureSession` removed
All sends now require `activeSessionId` to be set. If none, show error `'请先选择或新建会话'`.

## Files Changed
1. `website/src/views/ChatView.vue` — refactor session logic & toolbar
2. `website/src/views/NewSessionModal.vue` — new component (new file)
