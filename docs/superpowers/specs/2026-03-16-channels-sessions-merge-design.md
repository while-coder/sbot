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
列1(空) | 列2-4: Session ID (colspan=3，跨「名称/ID/类型」) | 列5: Agent ID | 列6: Saver ID | 列7: Memory ID | 列8: 查看/删除
```

- 子行背景色 `#fafaf9`，字体 monospace，字号 12px
- 加载中：显示"加载中..."占位行（colspan="7"，跨列2-8）
- 无会话：显示"暂无会话记录"占位行（colspan="7"，跨列2-8）
- **注意**：原 `ChannelsView` 的空状态行 `colspan="7"` 在添加展开列后需改为 `colspan="8"`

**`<style scoped>` 新增样式**（参照 SaversView 的 scoped 样式，`ChannelsView` 目前无 scoped 块，需新增）：

```css
.expand-btn {
  background: none; border: none; cursor: pointer;
  font-size: 10px; color: #9b9b9b;
  padding: 2px 6px; width: 28px; text-align: center; line-height: 1;
}
.expand-btn:hover { color: #1c1c1c; }
.session-sub-row td {
  background: #fafaf9; border-bottom: 1px solid #f0efed;
  padding-top: 5px; padding-bottom: 5px;
}
.session-sub-cell { padding: 5px 12px; font-size: 12px; color: #94a3b8; font-style: italic; }
.session-id-cell  { font-family: monospace; font-size: 12px; color: #3d3d3d; padding: 5px 12px; }
```

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
3. 已缓存（`id in sessionMap`）**或正在加载**（`channelLoading[id]`）时直接返回，防止重复请求（与 SaversView 的 `id in saverThreadsMap.value || saverLoading.value[id]` 逻辑一致）
4. 设置 `channelLoading[id] = true`，调用 `GET /api/channel-sessions?channel={id}`
5. 成功：结果存入 `sessionMap[id]`
6. 失败：调用 `show(e.message, 'error')`，再设置 `sessionMap[id] = []`（与 SaversView 顺序一致，填充缓存防止后续展开再次触发请求）
7. `finally`：设置 `channelLoading[id] = false`

**`refreshSessions(ids: string[])`**（新增辅助函数，参照 SaversView 的 `refreshThreads`）
- 并发重新拉取指定 channel 列表的会话，成功则覆盖 `sessionMap[id]`
- 每个 channel 独立 `try/catch`：失败时调用 `show(e.message, 'error')`，保留原有缓存（不写 `[]`，不影响其他 channel 的刷新）
- `finally`：更新对应 channel 的 `channelLoading[id] = false`

**`removeSession(channelId: string, session: ChannelSessionRow)`**
1. `confirm` 确认
2. `try/catch`：调用 `DELETE /api/channel-sessions/{session.id}`
3. 成功：从 `sessionMap[channelId]` 中移除该条目，调用 `show('删除成功')`
4. 失败：调用 `show(e.message, 'error')`

**`refresh()`**（增强现有函数）
- 刷新 `store.settings`（原有逻辑）
- 取所有 `expandedChannels[id] === true` 的 id 列表，调用 `refreshSessions(ids)` 覆盖缓存

#### 2.4 会话详情弹窗

从 `ChannelSessionsView` 迁移，使用 `class="modal-box wide"`（660px）：
- 点击子行「查看」按钮，设置 `viewSession`；遮罩层点击 `@click.self` 关闭
- 弹窗标题：`会话详情 — {sessionId}`
- 显示字段：ID、**频道**（channel）、Session ID (chat_id)、Agent ID、Saver ID、Memory ID
- 全部 `disabled` 只读输入框
- 底部「关闭」按钮（`btn-outline`），点击清空 `viewSession`
- 注：保留「频道」字段，在上下文不明确时仍有参考价值

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
