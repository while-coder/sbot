# 设计文档：将 ChannelSessionsView 合并到 ChannelsView

**日期：** 2026-03-16
**状态：** 已确认

---

## 背景

当前「频道管理」（`/channels`）和「频道会话」（`/channel-sessions`）是两个独立的页面。用户需要在两个页面之间切换才能查看某个频道的会话数据，体验割裂。

目标：将 `ChannelSessionsView` 合并进 `ChannelsView`，频道行展开后直接显示该频道的所有会话，交互模式与 `SaversView` 展开 threads 的方式完全一致。

---

## 变更范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `packages/sbot/src/Server/HttpServer.ts` | 修改 | `GET /api/channel-sessions` 新增可选 `?channel=id` 查询参数 |
| `packages/website/src/views/ChannelsView.vue` | 修改 | 增加展开功能、会话子行、会话详情弹窗 |
| `packages/website/src/router/index.ts` | 修改 | 删除 `/channel-sessions` 路由 |
| `packages/website/src/layouts/Layout.vue` | 修改 | 删除导航菜单中的「频道会话」入口 |
| `packages/website/src/views/ChannelSessionsView.vue` | 删除 | 功能已迁移，文件整体删除 |

---

## 详细设计

### 1. 后端：`HttpServer.ts`

`GET /api/channel-sessions` 新增可选 `?channel` 查询参数，有参时加 WHERE 过滤，无参时返回全部（向后兼容）。

```typescript
// 改前
app.get('/api/channel-sessions', api(async () => {
    return await database.findAll(database.channelSession);
}));

// 改后
app.get('/api/channel-sessions', api(async req => {
    const channel = req.query.channel as string | undefined
    const where = channel ? { channel } : undefined
    return await database.findAll(database.channelSession, { where })
}));
```

`DELETE /api/channel-sessions/:id` 无需改动。

---

### 2. 前端：`ChannelsView.vue`

#### 2.1 表格结构

**主行**（8 列，在原 7 列前插入展开列）：

```
▶/▼ | 名称 | ID | 类型 | Agent | 存储 | 记忆 | 操作
```

**展开后的会话子行**（跟随主行，与 SaversView `thread-sub-row` 样式一致）：

```
(空) | Session ID (colspan 3) | Agent ID | Saver ID | Memory ID | 查看 / 删除
```

- 子行背景色 `#fafaf9`，字体 monospace，字号 12px
- 加载中：显示"加载中..."占位行
- 无会话：显示"暂无会话记录"占位行

#### 2.2 新增状态

```typescript
interface ChannelSessionRow {
  id: number
  channel: string
  sessionId: string
  agentId: string
  saverId: string
  memoryId: string | null
}

const expandedChannels = ref<Record<string, boolean>>({})
const sessionMap       = ref<Record<string, ChannelSessionRow[]>>({})
const channelLoading   = ref<Record<string, boolean>>({})
const viewSession      = ref<ChannelSessionRow | null>(null)
```

#### 2.3 新增函数

**`toggleExpand(id: string)`**
1. 切换 `expandedChannels[id]`
2. 折叠时直接返回
3. 已缓存（`id in sessionMap`）时直接显示，不重复请求
4. 否则调用 `GET /api/channel-sessions?channel={id}`，结果存入 `sessionMap[id]`

**`removeSession(channelId: string, session: ChannelSessionRow)`**
1. `confirm` 确认
2. 调用 `DELETE /api/channel-sessions/{session.id}`
3. 成功后从 `sessionMap[channelId]` 中移除该条目

**`refresh()`**（增强现有函数）
- 刷新 `store.settings`（原有逻辑）
- 同时对所有已展开的 channel 重新拉取会话（覆盖缓存）

#### 2.4 会话详情弹窗

从 `ChannelSessionsView` 原样迁移：
- 点击子行「查看」按钮，设置 `viewSession`
- 弹窗标题：`会话详情 — {sessionId}`
- 显示字段：ID、Session ID (chat_id)、Agent ID、Saver ID、Memory ID
- 全部 `disabled` 只读输入框

---

### 3. 路由：`router/index.ts`

删除以下路由：

```typescript
{ path: '/channel-sessions', component: () => import('@/views/ChannelSessionsView.vue') },
```

---

### 4. 导航：`Layout.vue`

从「管理」分组中删除以下条目：

```typescript
{ label: '频道会话', key: '/channel-sessions' },
```

---

### 5. 删除文件

删除 `packages/website/src/views/ChannelSessionsView.vue`。

---

## 不在范围内

- 不新增会话的创建/编辑功能（会话由系统自动创建）
- 不改动会话的数据库结构
- 不改动 `SaverViewModal`（存储查看功能保持不变）
