# ChannelSessionsView 合并到 ChannelsView 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将独立的「频道会话」页面合并进「频道管理」页面，频道行展开后直接显示该频道的所有会话（Session）。

**Architecture:** 后端为 `GET /api/channel-sessions` 增加可选 `?channel=id` 过滤参数；前端 `ChannelsView` 复用 `SaversView` 的懒加载展开模式，展开行时按需拉取该频道会话并缓存；会话详情弹窗从 `ChannelSessionsView` 直接迁移。

**Tech Stack:** Vue 3 (Composition API) + TypeScript，Node.js/Express 后端，Sequelize ORM（`database.findAll`）。

**Spec:** `docs/superpowers/specs/2026-03-16-channels-sessions-merge-design.md`

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `packages/sbot/src/Server/HttpServer.ts` | 后端增加 `?channel` 过滤参数 |
| 修改 | `packages/website/src/views/ChannelsView.vue` | 增加展开功能、会话子行、会话详情弹窗、scoped 样式 |
| 修改 | `packages/website/src/router/index.ts` | 删除 `/channel-sessions` 路由 |
| 修改 | `packages/website/src/layouts/Layout.vue` | 删除导航「频道会话」入口 |
| 删除 | `packages/website/src/views/ChannelSessionsView.vue` | 功能已迁移 |

---

## Chunk 1：后端过滤参数

### Task 1：修改 `GET /api/channel-sessions`

**Files:**
- Modify: `packages/sbot/src/Server/HttpServer.ts`

- [ ] **Step 1：定位当前 handler**

  打开 `packages/sbot/src/Server/HttpServer.ts`，搜索 `channel-sessions`，找到以下代码块（约 781 行）：

  ```typescript
  app.get('/api/channel-sessions', api(async () => {
      return await database.findAll(database.channelSession);
  }));
  ```

- [ ] **Step 2：将 handler 替换为带过滤版本**

  将上面代码替换为：

  ```typescript
  app.get('/api/channel-sessions', api(async req => {
      const channel = req.query.channel as string | undefined
      const where = channel ? { channel } : undefined
      return await database.findAll(database.channelSession, { where })
  }));
  ```

  > 注意：`api()` 包装函数已有 `req` 参数支持，参考同文件其他 GET handler 写法。无参调用行为不变（向后兼容）。

- [ ] **Step 3：启动后端，验证过滤生效**

  ```bash
  # 无参：返回全部会话
  curl -s "http://localhost:3000/api/channel-sessions" | head -c 200

  # 带 channel 参数（替换为实际存在的 channel id）：只返回该频道会话
  curl -s "http://localhost:3000/api/channel-sessions?channel=<channel_id>" | head -c 200

  # 带不存在的 channel：返回空数组
  curl -s "http://localhost:3000/api/channel-sessions?channel=nonexistent"
  # 预期输出：{"data":[]}  或类似空数组结构
  ```

- [ ] **Step 4：提交**

  ```bash
  git add packages/sbot/src/Server/HttpServer.ts
  git commit -m "feat: support ?channel filter on GET /api/channel-sessions"
  ```

---

## Chunk 2：ChannelsView — script 逻辑

### Task 2：新增 interface、状态和展开相关函数

**Files:**
- Modify: `packages/website/src/views/ChannelsView.vue`（`<script setup>` 部分）

- [ ] **Step 1：在 `<script setup>` 中添加 `ChannelSessionRow` interface**

  在文件顶部 `import` 语句之后、第一个 `const` 之前，插入：

  ```typescript
  interface ChannelSessionRow {
    id: number
    channel: string
    sessionId: string
    agentId: string
    saverId: string
    memoryId: string | null
  }
  ```

- [ ] **Step 2：添加展开相关状态 ref**

  在现有 `const saverViewModal = ref(...)` 之后插入：

  ```typescript
  const expandedChannels = ref<Record<string, boolean>>({})
  const sessionMap       = ref<Record<string, ChannelSessionRow[]>>({})
  const channelLoading   = ref<Record<string, boolean>>({})
  const viewSession      = ref<ChannelSessionRow | null>(null)
  ```

- [ ] **Step 3：添加 `toggleExpand` 函数**

  在 `openAdd()` 函数之前插入：

  ```typescript
  async function toggleExpand(id: string) {
    expandedChannels.value[id] = !expandedChannels.value[id]
    if (!expandedChannels.value[id]) return
    if (id in sessionMap.value || channelLoading.value[id]) return
    channelLoading.value[id] = true
    try {
      const res = await apiFetch(`/api/channel-sessions?channel=${encodeURIComponent(id)}`)
      sessionMap.value[id] = res.data || []
    } catch (e: any) {
      show(e.message, 'error')
      sessionMap.value[id] = []
    } finally {
      channelLoading.value[id] = false
    }
  }
  ```

- [ ] **Step 4：添加 `refreshSessions` 辅助函数**

  紧接 `toggleExpand` 之后插入：

  ```typescript
  async function refreshSessions(ids: string[]) {
    await Promise.all(ids.map(async id => {
      channelLoading.value[id] = true
      try {
        const res = await apiFetch(`/api/channel-sessions?channel=${encodeURIComponent(id)}`)
        sessionMap.value[id] = res.data || []
      } catch (e: any) {
        show(e.message, 'error')
      } finally {
        channelLoading.value[id] = false
      }
    }))
  }
  ```

- [ ] **Step 5：添加 `removeSession` 函数**

  紧接 `refreshSessions` 之后插入：

  ```typescript
  async function removeSession(channelId: string, session: ChannelSessionRow) {
    if (!confirm(`确定要删除会话 "${session.sessionId}" 吗？`)) return
    try {
      await apiFetch(`/api/channel-sessions/${session.id}`, 'DELETE')
      const list = sessionMap.value[channelId]
      if (list) sessionMap.value[channelId] = list.filter(s => s.id !== session.id)
      show('删除成功')
    } catch (e: any) {
      show(e.message, 'error')
    }
  }
  ```

- [ ] **Step 6：增强现有 `refresh()` 函数**

  找到现有 `refresh()` 函数：

  ```typescript
  async function refresh() {
    try {
      const res = await apiFetch('/api/settings')
      Object.assign(store.settings, res.data)
    } catch (e: any) {
      show(e.message, 'error')
    }
  }
  ```

  替换为：

  ```typescript
  async function refresh() {
    try {
      const res = await apiFetch('/api/settings')
      Object.assign(store.settings, res.data)
      const expandedIds = Object.keys(expandedChannels.value).filter(id => expandedChannels.value[id])
      if (expandedIds.length > 0) await refreshSessions(expandedIds)
    } catch (e: any) {
      show(e.message, 'error')
    }
  }
  ```

- [ ] **Step 7：检查 TypeScript 编译**

  ```bash
  cd packages/website && npx vue-tsc --noEmit
  # 预期：无报错
  ```

  > 如果 `npx vue-tsc` 不可用，可跳过，在浏览器中验证无控制台错误。

- [ ] **Step 8：提交**

  ```bash
  git add packages/website/src/views/ChannelsView.vue
  git commit -m "feat: add session expand logic to ChannelsView"
  ```

---

## Chunk 3：ChannelsView — template、modal 和 scoped 样式

### Task 3：更新表格结构，添加展开列和会话子行

**Files:**
- Modify: `packages/website/src/views/ChannelsView.vue`（`<template>` 部分）

- [ ] **Step 1：在表头插入展开列**

  找到：

  ```html
  <tr><th>名称</th><th>ID</th><th>类型</th><th>Agent</th><th>存储</th><th>记忆</th><th>操作</th></tr>
  ```

  替换为：

  ```html
  <tr><th style="width:32px"></th><th>名称</th><th>ID</th><th>类型</th><th>Agent</th><th>存储</th><th>记忆</th><th>操作</th></tr>
  ```

- [ ] **Step 2：更新空状态行的 colspan**

  找到：

  ```html
  <tr v-if="Object.keys(channels).length === 0">
    <td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">暂无频道配置</td>
  </tr>
  ```

  替换为：

  ```html
  <tr v-if="Object.keys(channels).length === 0">
    <td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">暂无频道配置</td>
  </tr>
  ```

- [ ] **Step 3：将频道行改为 `<template v-for>` 包裹，并插入展开按钮和会话子行**

  找到：

  ```html
  <tr v-for="(c, id) in channels" :key="id">
    <td>{{ c.name || '-' }}</td>
    <td style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ id }}</td>
    <td>{{ c.type || '-' }}</td>
    <td>{{ agentOptions.find(a => a.id === c.agent)?.label || c.agent || '-' }}</td>
    <td>
      <button v-if="c.saver" class="table-link-btn" @click="saverViewModal?.open(c.saver, 'lark_' + id)">
        {{ saverOptions.find(s => s.id === c.saver)?.label || c.saver }}
      </button>
      <span v-else>-</span>
    </td>
    <td>{{ c.memory ? (memoryOptions.find(m => m.id === c.memory)?.label || c.memory) : '-' }}</td>
    <td>
      <div class="ops-cell">
        <button class="btn-outline btn-sm" @click="openEdit(id as string)">编辑</button>
        <button class="btn-danger btn-sm" @click="remove(id as string)">删除</button>
      </div>
    </td>
  </tr>
  ```

  替换为：

  ```html
  <template v-for="(c, id) in channels" :key="id">
    <tr>
      <td>
        <button class="expand-btn" @click="toggleExpand(id as string)">
          {{ expandedChannels[id as string] ? '▼' : '▶' }}
        </button>
      </td>
      <td>{{ c.name || '-' }}</td>
      <td style="font-family:monospace;font-size:11px;color:#9b9b9b">{{ id }}</td>
      <td>{{ c.type || '-' }}</td>
      <td>{{ agentOptions.find(a => a.id === c.agent)?.label || c.agent || '-' }}</td>
      <td>
        <button v-if="c.saver" class="table-link-btn" @click="saverViewModal?.open(c.saver, 'lark_' + id)">
          {{ saverOptions.find(s => s.id === c.saver)?.label || c.saver }}
        </button>
        <span v-else>-</span>
      </td>
      <td>{{ c.memory ? (memoryOptions.find(m => m.id === c.memory)?.label || c.memory) : '-' }}</td>
      <td>
        <div class="ops-cell">
          <button class="btn-outline btn-sm" @click="openEdit(id as string)">编辑</button>
          <button class="btn-danger btn-sm" @click="remove(id as string)">删除</button>
        </div>
      </td>
    </tr>
    <template v-if="expandedChannels[id as string]">
      <tr v-if="channelLoading[id as string]" class="session-sub-row">
        <td></td>
        <td colspan="7" class="session-sub-cell">加载中...</td>
      </tr>
      <tr v-else-if="(sessionMap[id as string] || []).length === 0" class="session-sub-row">
        <td></td>
        <td colspan="7" class="session-sub-cell">暂无会话记录</td>
      </tr>
      <tr v-for="s in sessionMap[id as string] || []" :key="s.id" class="session-sub-row">
        <td></td>
        <td colspan="3" class="session-id-cell">{{ s.sessionId }}</td>
        <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ s.agentId || '-' }}</td>
        <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ s.saverId || '-' }}</td>
        <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ s.memoryId || '-' }}</td>
        <td>
          <div class="ops-cell">
            <button class="btn-outline btn-sm" @click="viewSession = s">查看</button>
            <button class="btn-danger btn-sm" @click="removeSession(id as string, s)">删除</button>
          </div>
        </td>
      </tr>
    </template>
  </template>
  ```

### Task 4：添加会话详情弹窗

- [ ] **Step 4：在 `<SaverViewModal>` 标签之前插入会话详情弹窗**

  找到 `<SaverViewModal ref="saverViewModal" />`，在其**前面**插入：

  ```html
  <div v-if="viewSession" class="modal-overlay" @click.self="viewSession = null">
    <div class="modal-box wide">
      <div class="modal-header">
        <h3>会话详情 — {{ viewSession.sessionId }}</h3>
        <button class="modal-close" @click="viewSession = null">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>ID</label>
          <input :value="viewSession.id" disabled />
        </div>
        <div class="form-group">
          <label>频道</label>
          <input :value="viewSession.channel" disabled />
        </div>
        <div class="form-group">
          <label>Session ID (chat_id)</label>
          <input :value="viewSession.sessionId" disabled />
        </div>
        <div class="form-group">
          <label>Agent ID</label>
          <input :value="viewSession.agentId" disabled />
        </div>
        <div class="form-group">
          <label>Saver ID</label>
          <input :value="viewSession.saverId" disabled />
        </div>
        <div class="form-group">
          <label>Memory ID</label>
          <input :value="viewSession.memoryId ?? ''" disabled />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="viewSession = null">关闭</button>
      </div>
    </div>
  </div>
  ```

### Task 5：添加 `<style scoped>` 块

- [ ] **Step 5：在文件末尾（`</template>` 后）添加 scoped 样式**

  ```vue
  <style scoped>
  .expand-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 10px;
    color: #9b9b9b;
    padding: 2px 6px;
    width: 28px;
    text-align: center;
    line-height: 1;
  }
  .expand-btn:hover { color: #1c1c1c; }
  .session-sub-row td {
    background: #fafaf9;
    border-bottom: 1px solid #f0efed;
    padding-top: 5px;
    padding-bottom: 5px;
  }
  .session-sub-cell {
    padding: 5px 12px;
    font-size: 12px;
    color: #94a3b8;
    font-style: italic;
  }
  .session-id-cell {
    font-family: monospace;
    font-size: 12px;
    color: #3d3d3d;
    padding: 5px 12px;
  }
  </style>
  ```

- [ ] **Step 6：浏览器中验证功能**

  启动前端开发服务器，打开「频道管理」页面，验证：
  1. 每个频道行最左侧显示 `▶` 按钮
  2. 点击 `▶` 后展开变 `▼`，显示"加载中..."随即变为会话列表（或"暂无会话记录"）
  3. 再次点击 `▼` 收起
  4. 再次展开不重新发请求（从缓存读取）
  5. 点击「查看」弹出会话详情弹窗，字段正确，点关闭/遮罩可关闭
  6. 点击「删除」弹出确认，确认后该会话从列表中消失
  7. 点击工具栏「刷新」：设置刷新，已展开的频道会话列表也刷新

- [ ] **Step 7：提交**

  ```bash
  git add packages/website/src/views/ChannelsView.vue
  git commit -m "feat: add session expand rows and detail modal to ChannelsView"
  ```

---

## Chunk 4：清理 — 路由、导航、删除旧文件

### Task 6：删除路由、导航条目、旧文件

**Files:**
- Modify: `packages/website/src/router/index.ts`
- Modify: `packages/website/src/layouts/Layout.vue`
- Delete: `packages/website/src/views/ChannelSessionsView.vue`

- [ ] **Step 1：删除路由**

  打开 `packages/website/src/router/index.ts`，删除以下行：

  ```typescript
  { path: '/channel-sessions', component: () => import('@/views/ChannelSessionsView.vue') },
  ```

- [ ] **Step 2：删除导航条目**

  打开 `packages/website/src/layouts/Layout.vue`，在 `menuGroups` 中找到「管理」分组，删除以下条目：

  ```typescript
  { label: '频道会话', key: '/channel-sessions' },
  ```

- [ ] **Step 3：删除旧文件**

  ```bash
  rm packages/website/src/views/ChannelSessionsView.vue
  ```

- [ ] **Step 4：验证无编译错误**

  ```bash
  cd packages/website && npx vue-tsc --noEmit
  # 预期：无报错（特别是不应有对 ChannelSessionsView 的未解析引用）
  ```

- [ ] **Step 5：浏览器中验证**

  1. 侧边栏「管理」分组中不再出现「频道会话」菜单项
  2. 直接访问 `/#/channel-sessions`：页面空白或重定向（路由不存在，属于正常）
  3. 「频道管理」页面功能完整，无控制台报错

- [ ] **Step 6：提交**

  ```bash
  git add packages/website/src/router/index.ts packages/website/src/layouts/Layout.vue
  git add -u packages/website/src/views/ChannelSessionsView.vue
  git commit -m "feat: remove ChannelSessionsView, merge into ChannelsView"
  ```

---

## 完成验收

全部任务完成后，验证以下端到端场景：

1. **展开频道** → 显示该频道的所有会话（Session ID / Agent ID / Saver ID / Memory ID）
2. **查看会话详情** → 弹窗显示 ID、频道、Session ID、Agent ID、Saver ID、Memory ID
3. **删除会话** → 会话从列表消失，不影响其他频道展开状态
4. **刷新** → 已展开频道的会话列表同步刷新
5. **导航栏** → 无「频道会话」入口
6. **后端兼容** → 无 `?channel` 参数时返回全部会话（`SchedulerView` 等其他调用方不受影响）
