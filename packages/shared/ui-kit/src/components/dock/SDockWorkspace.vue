<template>
  <div ref="root" class="dock-workspace" :class="{ dragging: !!draggingId, mobile: isMobile }">
    <!--移动模式：所有组的 tab 合并进汉堡抽屉（横滚 tabbar 在面板多时会被截成单字）、激活面板满屏；
        不绑 @start-drag，拖拽/分屏/detach 自然全失效。状态树完全不动，断点穿越时桌面渲染精确还原-->
    <SDockTabDrawer
      v-if="isMobile && mobileTabItems.length > 1"
      class="dock-mobile-bar"
      :items="mobileTabItems"
      :active-id="state.activeTabId"
      :quick-ids="mobileQuickIds"
      @activate="focusTab"
      @close="closeTab"
    >
      <template #tab="{ item }">
        <slot name="tab" :item="item" />
      </template>
    </SDockTabDrawer>
    <template v-else-if="!isMobile">
    <SDockTabbar
      v-for="rect in rects.groups"
      :key="rect.groupId"
      :ref="instance => setGroupElement(rect.groupId, instance)"
      class="dock-group"
      :class="{ focused: state.focusedGroupId === rect.groupId, ...dropClassFor(undefined, rect.groupId) }"
      :style="groupStyle(rect)"
      :items="groupItems(state, rect.groupId)"
      :active-id="findGroup(state, rect.groupId)?.activeId ?? ''"
      :insert-index="insertIndexFor(undefined, rect.groupId)"
      :focused="state.focusedGroupId === rect.groupId"
      @activate="focusTab"
      @close="closeTab"
      @start-drag="startPointerDrag"
      @toggle-float="toggleFloat"
    >
      <template #tab="{ item }">
        <slot name="tab" :item="item" />
      </template>
      <div v-if="!findGroup(state, rect.groupId)?.activeId" class="dock-group-empty">
        <slot name="empty">把 tab 拖到这里</slot>
      </div>
      <div class="dock-drop-indicator"></div>
    </SDockTabbar>

    <div
      v-for="splitRect in rects.splits"
      :key="splitRect.splitId"
      class="dock-resizer"
      :class="splitRect.direction"
      :style="splitStyle(splitRect)"
      @pointerdown.prevent="startSplitResize($event, splitRect)"
      @dblclick="setSplitRatio(state, splitRect.splitId, 50)"
    ></div>
    </template>

    <!--悬浮窗 = 独立小工作区：内嵌自己的布局树，支持多组/分屏/组内多 tab（类 Unity）。
        只画外壳：各组的 tab 条（WorkspaceTabbar）+ 分隔条 + 缩放手柄，组按百分比定位在框架内。
        tab 条空白处按下 = 拖整窗、双击 = 整窗回停靠；浮窗不放关闭按钮——二级面板 tab 都是
        pinned 不可关闭，逐 tab 关闭钮只在非 pinned 时出现，整窗回收靠双击空白/拖回表头。
        z 序 = 22 + 2*数组序，高于自己的内容层（21 + 2*数组序）——框架盖住内容边框，
        但 pointer-events: none 让中段点击穿透到内容，tab 条/分隔条/手柄单独开。
        floats 数组顺序即 z 序-->
    <template v-if="floatEnabled && !isMobile">
      <div
        v-for="(float, floatIndex) in state.floats"
        :key="float.id"
        :ref="element => setFloatElement(float.id, element)"
        class="dock-float-frame"
        :class="{
          'frame-dragging': floatDraggingId === float.id,
          'drop-float': dropTarget?.floatId === float.id,
        }"
        :style="floatFrameStyle(float, floatIndex)"
        @pointerdown.capture="focusTab(float.state.activeTabId)"
      >
        <SDockTabbar
          v-for="rect in floatRects.get(float.id)?.groups ?? []"
          :key="rect.groupId"
          :ref="instance => setFloatGroupElement(float.id, rect.groupId, instance)"
          class="dock-group"
          :class="{ focused: float.state.focusedGroupId === rect.groupId, ...dropClassFor(float.id, rect.groupId) }"
          :style="groupStyle(rect)"
          :items="groupItems(float.state, rect.groupId)"
          :active-id="findGroup(float.state, rect.groupId)?.activeId ?? ''"
          :insert-index="insertIndexFor(float.id, rect.groupId)"
          :focused="float.state.focusedGroupId === rect.groupId"
          @activate="focusTab"
          @close="closeTab"
          @start-drag="startPointerDrag"
          @toggle-float="toggleFloat"
          @bar-drag="event => startFloatDrag(event, float.id)"
          @bar-dblclick="unfloatFloat(float.id)"
        >
          <template #tab="{ item }">
            <slot name="tab" :item="item" />
          </template>
          <div v-if="!findGroup(float.state, rect.groupId)?.activeId" class="dock-group-empty">
            <slot name="empty">把 tab 拖到这里</slot>
          </div>
          <div class="dock-drop-indicator"></div>
        </SDockTabbar>
        <div
          v-for="splitRect in floatRects.get(float.id)?.splits ?? []"
          :key="splitRect.splitId"
          class="dock-resizer"
          :class="splitRect.direction"
          :style="splitStyle(splitRect)"
          @pointerdown.prevent="startSplitResize($event, splitRect, float.id)"
          @dblclick="setSplitRatio(float.state, splitRect.splitId, 50)"
        ></div>
        <div class="dock-float-resize" @pointerdown.prevent="startFloatResize($event, float.id)"></div>
      </div>
    </template>

    <!--内容统一绝对定位（像 sterm 挂 xterm 一样）：面板有轮询/选中态，不能随切换销毁重建，
        首次激活才挂载、之后 v-show 常驻。浮窗内容复用同一批 div（只换定位），slot 实例全局唯一，
        tab 在停靠区/浮窗/浮窗内嵌组之间怎么挪都不会重挂载——所以浮窗嵌的是布局树而不是组件-->
    <div
      v-for="item in items"
      v-show="itemVisible(item)"
      :key="item.id"
      class="dock-content"
      :class="{ 'float-content-dragging': isFloatContentDragging(item.id) }"
      :style="contentStyle(item)"
      @pointerdown.capture="focusTab(item.id)"
      @focusin.capture="focusTab(item.id)"
    >
      <slot v-if="everActivated.has(item.id)" name="content" :item="item"></slot>
    </div>

    <div
      v-if="draggingId"
      class="dock-drag-ghost"
      :class="{ 'will-float': ghostWillFloat }"
      :style="{ left: `${dragPoint.x + 12}px`, top: `${dragPoint.y + 12}px` }"
    >
      {{ itemMap.get(draggingId)?.title }}
    </div>
  </div>
</template>
<script lang="ts">
//可拖拽工作区主体：布局树渲染（layoutRects 展开成百分比矩形）+ pointer 拖拽状态机 +
//drop 命中判定 + 悬浮窗组（floats，多 tab，拖整窗/拖 tab 两套落点规则）。
//移植自 sterm 的 EditorWorkbench，state 由父组件持有 reactive、这里原地变更。
import { computed, defineComponent, onBeforeUnmount, reactive, ref, watch } from "vue";
/**
 * 可拖拽工作区的布局树内核：二叉分割树 + 组内 tab 条（类 VSCode 编辑区模型）。
 * 树只管分组几何，叶子组内是平铺的 tab id 列表；全部是纯函数，不依赖 Vue/Tauri，
 * 由 SDockWorkspace 渲染、PageClient/ClientInfo 持有 state 并负责持久化。
 *
 * 移植自 sterm 的 editorWorkspace.ts（拖拽分屏已验证的同一套数据结构）。
 */

export type DropEdge = "left" | "right" | "top" | "bottom"

export interface TabGroup {
  id: string
  tabs: string[]
  activeId: string
}

export interface GroupNode {
  type: "group"
  groupId: string
}

export interface SplitNode {
  type: "split"
  id: string
  direction: "horizontal" | "vertical"
  ratio: number
  first: LayoutNode
  second: LayoutNode
}

export type LayoutNode = GroupNode | SplitNode

export interface WorkspaceState {
  root: LayoutNode | null
  groups: TabGroup[]
  focusedGroupId: string
  activeTabId: string
  /**悬浮窗（类 Unity 浮动窗口）：每个浮窗内嵌一棵自己的布局树（与主树同一套纯函数），
     内部支持多组/分屏/组内多 tab；floats 数组顺序即 z 序（末尾在最上层），随布局快照持久化*/
  floats: FloatState[]
}

export interface FloatState {
  id: string
  /**浮窗自己的工作区状态：root/groups/activeTabId 齐全；浮窗内不再嵌套浮窗（state.floats 恒空）*/
  state: WorkspaceState
  /**容器相对 px 坐标；出界裁剪交给渲染层 CSS clamp（restore 是纯函数，不知道容器尺寸）*/
  x: number
  y: number
  width: number
  height: number
}

export const FLOAT_MIN_WIDTH = 220
export const FLOAT_MIN_HEIGHT = 160
/**浮窗默认尺寸（拖出/双击浮起时没有现成尺寸可用）*/
export const FLOAT_DEFAULT_WIDTH = 320
export const FLOAT_DEFAULT_HEIGHT = 420

export interface GroupRect {
  groupId: string
  left: number
  top: number
  width: number
  height: number
}

export interface SplitRect {
  splitId: string
  direction: "horizontal" | "vertical"
  left: number
  top: number
  width: number
  height: number
  boundary: number
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
}

export function createWorkspace(): WorkspaceState {
  //floats 必须有：重置布局走 Object.assign(ws, restoreWorkspace(...))，缺字段会残留旧浮窗
  return { root: null, groups: [], focusedGroupId: "", activeTabId: "", floats: [] }
}

export function findFloatById(state: WorkspaceState, floatId: string): FloatState | undefined {
  return state.floats.find(float => float.id === floatId)
}

/**按 tab id 找它所在的浮窗（浮 tab 在浮窗自己的内嵌树里）*/
export function findFloat(state: WorkspaceState, id: string): FloatState | undefined {
  return state.floats.find(float => !!findTabGroup(float.state, id))
}

export function isFloating(state: WorkspaceState, id: string): boolean {
  return !!findFloat(state, id)
}

interface FloatRect {
  x: number
  y: number
  width: number
  height: number
}

function clampFloatRect(rect: FloatRect): FloatRect {
  return {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    width: Math.max(FLOAT_MIN_WIDTH, rect.width),
    height: Math.max(FLOAT_MIN_HEIGHT, rect.height),
  }
}

/**移除浮窗条目（浮窗被搬空/整窗回收后由调用方收尾）*/
export function removeFloatEntry(state: WorkspaceState, floatId: string): void {
  const index = state.floats.findIndex(float => float.id === floatId)
  if (index >= 0) state.floats.splice(index, 1)
}

/**tab id 实际归属的工作区状态：主树本身，或包含它的浮窗的内嵌树（跨层搬运时找源状态用）*/
export function findTabOwnerState(state: WorkspaceState, id: string): WorkspaceState | undefined {
  if (findTabGroup(state, id)) return state
  return state.floats.find(float => !!findTabGroup(float.state, id))?.state
}

function detachTabFromTree(state: WorkspaceState, id: string): void {
  const group = findTabGroup(state, id)
  if (!group) return
  const index = group.tabs.indexOf(id)
  group.tabs.splice(index, 1)
  if (group.activeId === id) group.activeId = group.tabs[index] ?? group.tabs[index - 1] ?? ""
  removeEmptyGroup(state, group)
}

/**把 tab 从当前归属（主树或某个浮窗的内嵌树）摘出，浮窗被搬空时顺带移除条目。
    state 必须是顶层状态：浮窗条目清理只认 state.floats，传内嵌 state 会漏掉清理留孤儿空壳*/
function detachTabFromSource(state: WorkspaceState, id: string): void {
  const float = findFloat(state, id)
  if (float) {
    detachTabFromTree(float.state, id)
    if (float.state.activeTabId === id) {
      float.state.activeTabId = findGroup(float.state, float.state.focusedGroupId)?.activeId ?? ""
    }
    if (!allTabIds(float.state).length) removeFloatEntry(state, float.id)
    return
  }
  detachTabFromTree(state, id)
}

/**在 state 上新建一个只含 id 的浮窗（id 须已脱离任何树/浮窗）*/
function pushFloat(
  state: WorkspaceState,
  id: string,
  rect?: { x?: number; y?: number; width?: number; height?: number },
): void {
  const full = clampFloatRect({
    x: rect?.x ?? 40,
    y: rect?.y ?? 40,
    width: rect?.width ?? FLOAT_DEFAULT_WIDTH,
    height: rect?.height ?? FLOAT_DEFAULT_HEIGHT,
  })
  const nested = createWorkspace()
  addTab(nested, id)
  state.floats.push({ id: uid("float"), state: nested, x: full.x, y: full.y, width: full.width, height: full.height })
  state.activeTabId = id
}

/**浮起一个 tab 成新浮窗（已在浮窗中则摘出重浮到新位置——把 tab 拖出浮窗到空白处建新窗靠这个语义）。
    isMobile 的拦截由调用方做（内核不感知断点）*/
export function floatTab(
  state: WorkspaceState,
  id: string,
  rect?: { x?: number; y?: number; width?: number; height?: number },
): void {
  if (!findFloat(state, id) && !findTabGroup(state, id)) return
  detachTabFromSource(state, id)
  pushFloat(state, id, rect)
}

/**取消单个 tab 的悬浮：回到焦点组（addTab 负责激活），浮窗只剩它自己时顺带移除*/
export function unfloatTab(state: WorkspaceState, id: string): void {
  const float = findFloat(state, id)
  if (!float) return
  detachTabFromTree(float.state, id)
  if (!allTabIds(float.state).length) removeFloatEntry(state, float.id)
  addTab(state, id)
}

/**把 tab 从其当前归属（主树或某个浮窗的内嵌树）整体拔出、不插回——跨浮窗/跨层搬运用。
    state 必须是顶层状态（见 detachTabFromSource：内嵌 state 查不到浮窗条目，搬空后留孤儿）*/
export function pluckTab(state: WorkspaceState, id: string): void {
  detachTabFromSource(state, id)
  if (state.activeTabId === id) state.activeTabId = findGroup(state, state.focusedGroupId)?.activeId ?? ""
}

/**把已拔出的 tab 插到目标组（无 edge 按位插入，有 edge 四向分屏）；组缺省取焦点组*/
export function insertTab(
  state: WorkspaceState,
  id: string,
  groupId?: string,
  index?: number,
  edge?: DropEdge,
): void {
  const target = (groupId ? findGroup(state, groupId) : undefined) ?? findGroup(state, state.focusedGroupId) ?? state.groups[0]
  if (!target) {
    addTab(state, id)
    return
  }
  if (edge) {
    const created = newGroup([id])
    state.groups.push(created)
    const direction = edge === "left" || edge === "right" ? "horizontal" : "vertical"
    const before = edge === "left" || edge === "top"
    const replacement = split(
      direction,
      before ? leaf(created) : leaf(target),
      before ? leaf(target) : leaf(created),
      50,
    )
    if (state.root) state.root = replaceGroupNode(state.root, target.id, replacement)
    activateTab(state, created.id, id)
    return
  }
  const at = Math.max(0, Math.min(index ?? target.tabs.length, target.tabs.length))
  target.tabs.splice(at, 0, id)
  activateTab(state, target.id, id)
}

/**整窗回收：浮窗全部 tab 按 DFS 序并入焦点组，返回原本激活的 tab id（调用方用于恢复激活）*/
export function dockFloat(state: WorkspaceState, floatId: string): string {
  const float = findFloatById(state, floatId)
  if (!float) return ""
  const tabs = allTabIds(float.state)
  const activeId = float.state.activeTabId
  removeFloatEntry(state, floatId)
  for (const id of tabs) addTab(state, id)
  if (tabs.length) activateTabById(state, activeId)
  return activeId
}

export function updateFloatRect(
  state: WorkspaceState,
  floatId: string,
  patch: Partial<Pick<FloatState, "x" | "y" | "width" | "height">>,
): void {
  const float = findFloatById(state, floatId)
  if (!float) return
  Object.assign(float, patch)
  const clamped = clampFloatRect(float)
  float.x = clamped.x
  float.y = clamped.y
  float.width = clamped.width
  float.height = clamped.height
}

/**置顶：把浮窗移到 floats 末尾（数组顺序即 z 序）*/
export function bringFloatToFront(state: WorkspaceState, floatId: string): void {
  const index = state.floats.findIndex(float => float.id === floatId)
  if (index < 0 || index === state.floats.length - 1) return
  const [entry] = state.floats.splice(index, 1)
  state.floats.push(entry)
}

export function findGroup(state: WorkspaceState, groupId: string): TabGroup | undefined {
  return state.groups.find(group => group.id === groupId)
}

export function findTabGroup(state: WorkspaceState, id: string): TabGroup | undefined {
  return state.groups.find(group => group.tabs.includes(id))
}

function newGroup(tabIds: string[]): TabGroup {
  return { id: uid("group"), tabs: [...tabIds], activeId: tabIds[0] ?? "" }
}

function leaf(group: TabGroup): GroupNode {
  return { type: "group", groupId: group.id }
}

function split(direction: "horizontal" | "vertical", first: LayoutNode, second: LayoutNode, ratio = 50): SplitNode {
  return { type: "split", id: uid("split"), direction, ratio, first, second }
}

function replaceGroupNode(node: LayoutNode, groupId: string, replacement: LayoutNode): LayoutNode {
  if (node.type === "group") return node.groupId === groupId ? replacement : node
  return { ...node, first: replaceGroupNode(node.first, groupId, replacement), second: replaceGroupNode(node.second, groupId, replacement) }
}

function removeGroupNode(node: LayoutNode, groupId: string): LayoutNode | null {
  if (node.type === "group") return node.groupId === groupId ? null : node
  const first = removeGroupNode(node.first, groupId)
  const second = removeGroupNode(node.second, groupId)
  if (!first) return second
  if (!second) return first
  return { ...node, first, second }
}

function removeEmptyGroup(state: WorkspaceState, group: TabGroup): void {
  if (group.tabs.length || state.groups.length <= 1) return
  state.groups.splice(state.groups.indexOf(group), 1)
  if (state.root) state.root = removeGroupNode(state.root, group.id)
  if (state.focusedGroupId === group.id) state.focusedGroupId = state.groups[0]?.id ?? ""
}

/** 激活某组内的 tab（组切换 + 全局激活联动，拖拽/点击落点都走这里）。
    浮 tab 不经过这里（不在树里），统一走 activateTabById 的浮窗分支 */
export function activateTab(state: WorkspaceState, groupId: string, id: string): void {
  const group = findGroup(state, groupId)
  if (!group?.tabs.includes(id)) return
  group.activeId = id
  state.focusedGroupId = group.id
  state.activeTabId = id
}

/** 按 tabId 激活（不关心它在主树还是某个浮窗的内嵌树里）：inspect 跳转、Ctrl+Tab 切换用 */
export function activateTabById(state: WorkspaceState, id: string): void {
  const float = findFloat(state, id)
  if (float) {
    activateTabById(float.state, id)
    state.activeTabId = id
    return
  }
  const group = findTabGroup(state, id)
  if (group) activateTab(state, group.id, id)
}

/** DFS 顺序枚举全部 tab id（Ctrl+Tab 循环、strip、移动端抽屉用）：主树在前，各浮窗按序在后 */
export function allTabIds(state: WorkspaceState): string[] {
  const ids: string[] = []
  function visit(node: LayoutNode): void {
    if (node.type === "group") {
      const group = findGroup(state, node.groupId)
      if (group) ids.push(...group.tabs)
      return
    }
    visit(node.first)
    visit(node.second)
  }
  if (state.root) visit(state.root)
  for (const float of state.floats) ids.push(...allTabIds(float.state))
  return ids
}

export function addTab(state: WorkspaceState, id: string): void {
  if (findTabGroup(state, id) || isFloating(state, id)) return
  if (!state.root || !state.groups.length) {
    const group = newGroup([id])
    state.groups.push(group)
    state.root = leaf(group)
    activateTab(state, group.id, id)
    return
  }
  const group = findGroup(state, state.focusedGroupId) ?? state.groups[0]
  group.tabs.push(id)
  activateTab(state, group.id, id)
}

export function removeTab(state: WorkspaceState, id: string): void {
  const float = findFloat(state, id)
  if (float) {
    detachTabFromTree(float.state, id)
    if (!allTabIds(float.state).length) removeFloatEntry(state, float.id)
    if (state.activeTabId === id) {
      const focused = findGroup(state, state.focusedGroupId) ?? state.groups[0]
      state.activeTabId = focused?.activeId ?? state.floats[0]?.state.activeTabId ?? ""
    }
    return
  }
  const group = findTabGroup(state, id)
  if (!group) return
  const index = group.tabs.indexOf(id)
  group.tabs.splice(index, 1)
  if (group.activeId === id) {
    group.activeId = group.tabs[index] ?? group.tabs[index - 1] ?? ""
  }
  removeEmptyGroup(state, group)

  if (state.activeTabId === id) {
    const focused = findGroup(state, state.focusedGroupId) ?? state.groups[0]
    state.activeTabId = focused?.activeId ?? ""
  }
}

/**
 * 同一状态内的树组之间移动 tab：无 edge 是组内/组间排序，有 edge 是四向分屏
 * （在目标组位置上替换为一个 split 节点，新组占 edge 那一侧）。
 * 跨状态（主树 ↔ 浮窗内嵌树）的移动走 pluckTab + insertTab，由渲染层路由。
 */
export function moveTab(
  state: WorkspaceState,
  id: string,
  targetGroupId: string,
  targetIndex?: number,
  edge?: DropEdge,
): void {
  const source = findTabGroup(state, id)
  const target = findGroup(state, targetGroupId)
  if (!source || !target) return
  //单 tab 的组拖到自己边缘会拆出零面积组，直接忽略
  if (edge && source === target && source.tabs.length === 1) return

  const oldIndex = source.tabs.indexOf(id)
  source.tabs.splice(oldIndex, 1)
  if (source.activeId === id) {
    source.activeId = source.tabs[oldIndex] ?? source.tabs[oldIndex - 1] ?? ""
  }

  if (!edge) {
    let index = targetIndex ?? target.tabs.length
    if (source === target && oldIndex < index) index -= 1
    index = Math.max(0, Math.min(index, target.tabs.length))
    target.tabs.splice(index, 0, id)
    removeEmptyGroup(state, source)
    activateTab(state, target.id, id)
    return
  }

  const created = newGroup([id])
  state.groups.push(created)
  const direction = edge === "left" || edge === "right" ? "horizontal" : "vertical"
  const before = edge === "left" || edge === "top"
  const replacement = split(
    direction,
    before ? leaf(created) : leaf(target),
    before ? leaf(target) : leaf(created),
    50,
  )
  if (state.root) state.root = replaceGroupNode(state.root, target.id, replacement)
  removeEmptyGroup(state, source)
  activateTab(state, created.id, id)
}

export function setSplitRatio(state: WorkspaceState, splitId: string, ratio: number): void {
  const clamped = Math.max(15, Math.min(85, Math.round(ratio * 10) / 10))
  function visit(node: LayoutNode): boolean {
    if (node.type === "group") return false
    if (node.id === splitId) {
      node.ratio = clamped
      return true
    }
    return visit(node.first) || visit(node.second)
  }
  if (state.root) visit(state.root)
}

/** 把树展开成百分比矩形：groups 是各叶子组区域，splits 是各分隔条位置 */
export function layoutRects(state: WorkspaceState): { groups: GroupRect[]; splits: SplitRect[] } {
  const groups: GroupRect[] = []
  const splits: SplitRect[] = []
  function visit(node: LayoutNode, left: number, top: number, width: number, height: number): void {
    if (node.type === "group") {
      groups.push({ groupId: node.groupId, left, top, width, height })
      return
    }
    if (node.direction === "horizontal") {
      const firstWidth = width * node.ratio / 100
      splits.push({
        splitId: node.id,
        direction: node.direction,
        left,
        top,
        width,
        height,
        boundary: left + firstWidth,
      })
      visit(node.first, left, top, firstWidth, height)
      visit(node.second, left + firstWidth, top, width - firstWidth, height)
    } else {
      const firstHeight = height * node.ratio / 100
      splits.push({
        splitId: node.id,
        direction: node.direction,
        left,
        top,
        width,
        height,
        boundary: top + firstHeight,
      })
      visit(node.first, left, top, width, firstHeight)
      visit(node.second, left, top + firstHeight, width, height - firstHeight)
    }
  }
  if (state.root) visit(state.root, 0, 0, 100, 100)
  return { groups, splits }
}

// ↓ 持久化：序列化输出 plain object，恢复时做全量 normalize——
//   结构校验、白名单/剥离、去重、截断、空组剪枝、activeId 纠正都在 restore 一处做，
//   frontendSettings 只负责把原始值透传过来。

export interface WorkspaceSnapshot {
  root: LayoutNode | null
  groups: { id: string; tabs: string[]; activeId: string }[]
  focusedGroupId: string
  activeTabId: string
  /**旧格式快照没有该字段，restore 落空数组兜底；更旧的扁平 floats 格式（tabs 字段）也会被丢弃*/
  floats?: FloatSnapshot[]
}

export interface FloatSnapshot {
  x: number
  y: number
  width: number
  height: number
  /**浮窗自己的布局快照（浮窗内不再嵌套浮窗，snapshot.floats 恒为空）*/
  snapshot: WorkspaceSnapshot
}

export interface SerializeOptions {
  /** 返回 true 的 tab id 不落盘（如内存态的快照 tab） */
  strip?: (id: string) => boolean
}

export function serializeWorkspace(state: WorkspaceState, options: SerializeOptions = {}): WorkspaceSnapshot {
  const clone: WorkspaceState = {
    root: state.root ? JSON.parse(JSON.stringify(state.root)) : null,
    groups: state.groups.map(group => ({ id: group.id, tabs: [...group.tabs], activeId: group.activeId })),
    focusedGroupId: state.focusedGroupId,
    activeTabId: state.activeTabId,
    floats: [],
  }
  if (options.strip) {
    for (const id of allTabIds(clone)) {
      if (options.strip(id)) removeTab(clone, id)
    }
  }
  return {
    root: clone.root,
    groups: clone.groups.map(group => ({ id: group.id, tabs: [...group.tabs], activeId: group.activeId })),
    focusedGroupId: clone.focusedGroupId,
    activeTabId: clone.activeTabId,
    floats: state.floats
      .map(float => ({
        x: float.x,
        y: float.y,
        width: float.width,
        height: float.height,
        //浮窗内嵌树递归走同一套序列化（strip 同样生效），strip 搬空后整条丢弃
        snapshot: serializeWorkspace(float.state, { strip: options.strip }),
      }))
      .filter(float => float.snapshot.groups.length > 0 || (float.snapshot.floats?.length ?? 0) > 0),
  }
}

export interface RestoreOptions {
  /** 恢复结果一个 tab 都没有时，用这些 id 引导出初始布局 */
  fallbackTabs?: string[]
  /** 恢复结果一个组都没有时，优先用这份快照恢复（默认布局），fallbackTabs 是它的兜底 */
  defaultSnapshot?: WorkspaceSnapshot
  /** tab id 白名单，不在名单内的直接丢弃（如二级面板的固定名单） */
  allowedIds?: (id: string) => boolean
  maxTabs?: number
  /**跨状态共享的去重集合（恢复浮窗内嵌树时传入，同一 tab 不会在主树和浮窗里各出现一次）*/
  seen?: Set<string>
}

function pruneRoot(root: LayoutNode, validGroupIds: Set<string>): LayoutNode | null {
  if (root.type === "group") return validGroupIds.has(root.groupId) ? root : null
  const first = pruneRoot(root.first, validGroupIds)
  const second = pruneRoot(root.second, validGroupIds)
  if (!first) return second
  if (!second) return first
  return { ...root, first, second }
}

export function restoreWorkspace(raw: unknown, options: RestoreOptions = {}): WorkspaceState {
  const state = createWorkspace()
  const rawSnapshot = raw as WorkspaceSnapshot | null | undefined
  const groupsRaw = Array.isArray(rawSnapshot?.groups) ? rawSnapshot!.groups : []
  const allowedIds = options.allowedIds
  const maxTabs = options.maxTabs ?? Infinity

  //先收集合法 tab id：白名单过滤 + 全局去重 + 上限截断（组顺序遍历，先到先得）。
  //seen 可由外部传入：恢复浮窗内嵌树时与主树共享同一个去重集合
  const seen = options.seen ?? new Set<string>()
  const groups: { id: string; tabs: string[]; activeId: string; rawActiveId: unknown }[] = []
  const usedGroupIds = new Set<string>()
  for (const groupRaw of groupsRaw) {
    if (groupRaw == null || typeof groupRaw !== "object") continue
    const tabsRaw = Array.isArray((groupRaw as any).tabs) ? (groupRaw as any).tabs : []
    const tabs: string[] = []
    for (const id of tabsRaw) {
      if (typeof id !== "string" || id === "") continue
      if (allowedIds && !allowedIds(id)) continue
      if (seen.has(id) || seen.size >= maxTabs) continue
      seen.add(id)
      tabs.push(id)
    }
    if (tabs.length) {
      //原始 group id 尽量保留（root 引用它们）；缺失/重复的补新的
      const rawId = (groupRaw as any).id
      const id = typeof rawId === "string" && rawId !== "" && !usedGroupIds.has(rawId) ? rawId : uid("group")
      usedGroupIds.add(id)
      groups.push({ id, tabs, activeId: "", rawActiveId: (groupRaw as any).activeId })
    }
    if (seen.size >= maxTabs) break
  }
  //floats：矩形四值必须全为有限数、内嵌快照 restore 后得有 tab，否则整条丢弃。
  //内嵌 restore 与主树共享 allowedIds/maxTabs/seen（白名单与去重一处收口）；
  //旧格式（扁平 tabs/单 tab 浮窗）没有 snapshot 字段，自然被丢弃，落回停靠区
  const MAX_FLOATS = 16
  const floats: FloatState[] = []
  const floatsRaw = Array.isArray(rawSnapshot?.floats) ? rawSnapshot!.floats : []
  for (const floatRaw of floatsRaw) {
    if (floats.length >= MAX_FLOATS) break
    if (floatRaw == null || typeof floatRaw !== "object") continue
    const { x, y, width, height } = floatRaw as any
    if (![x, y, width, height].every(value => typeof value === "number" && Number.isFinite(value))) continue
    const nested = restoreWorkspace((floatRaw as any).snapshot, { allowedIds, maxTabs, seen })
    if (!allTabIds(nested).length) continue
    floats.push({
      id: uid("float"),
      state: nested,
      x: Math.max(0, Math.min(4096, x)),
      y: Math.max(0, Math.min(4096, y)),
      width: Math.max(FLOAT_MIN_WIDTH, Math.min(4096, width)),
      height: Math.max(FLOAT_MIN_HEIGHT, Math.min(4096, height)),
    })
  }
  if (!groups.length && !floats.length) {
    if (options.defaultSnapshot) {
      //默认布局本身也走一遍同样的 normalize（白名单/去重/剪枝都在），防止循环把自身置空
      return restoreWorkspace(options.defaultSnapshot, { ...options, defaultSnapshot: undefined })
    }
    for (const id of options.fallbackTabs ?? []) addTab(state, id)
    //addTab 会逐个激活，兜底布局最终停在最后一个 tab 上；纠正回第一个
    const first = (options.fallbackTabs ?? [])[0]
    if (first) activateTabById(state, first)
    return state
  }
  const validGroupIds = new Set(groups.map(group => group.id))

  //root：能剪枝出合法树就用，否则按组顺序折叠成链式 split 兜底
  let root: LayoutNode | null = null
  if (rawSnapshot?.root != null && typeof rawSnapshot.root === "object") {
    try {
      root = pruneRoot(JSON.parse(JSON.stringify(rawSnapshot.root)) as LayoutNode, validGroupIds)
    } catch {
      root = null
    }
  }
  if (!root) {
    //只有浮窗没有停靠组时树为 null：停靠区空置，全部内容在浮窗里
    root = groups.length ? leaf(groups[0]) : null
    for (let i = 1; i < groups.length; i++) {
      root = split(i % 2 ? "horizontal" : "vertical", root, leaf(groups[i]), 50)
    }
  }

  state.groups = groups
  state.root = root

  //activeId 纠正：组内激活必须存在于组里，全局激活必须存在于某个组/浮窗里
  for (const group of groups) {
    const wanted = typeof group.rawActiveId === "string" ? group.rawActiveId : ""
    group.activeId = group.tabs.includes(wanted) ? wanted : group.tabs[0]
  }
  state.floats = floats
  state.focusedGroupId = groups.length
    ? (validGroupIds.has(rawSnapshot?.focusedGroupId as string) ? rawSnapshot!.focusedGroupId as string : groups[0].id)
    : ""
  const rawActiveTab = rawSnapshot?.activeTabId as string
  state.activeTabId = typeof rawActiveTab === "string" && allTabIds(state).includes(rawActiveTab)
    ? rawActiveTab
    : findGroup(state, state.focusedGroupId)?.activeId ?? groups[0]?.activeId ?? floats[0]?.state.activeTabId ?? ""
  return state
}


import SDockTabbar, { type TabbarItem } from "./SDockTabbar.vue";
import SDockTabDrawer from "./SDockTabDrawer.vue";

export interface DockItem {
  id: string
  title: string
  kind?: string
  /** 不可关闭（如顶层"列表"tab、二级固定面板）；仍可被其他 tab drop 合组 */
  pinned?: boolean
  /** 允许拖出窗口边缘 detach 成独立窗口 */
  detachable?: boolean
}

interface DropTarget {
  groupId?: string
  floatId?: string
  edge?: DropEdge
  index?: number
  /**表头命中（tab 条按位插入/贴靠）：指示画 tab 条插入竖线，而不是内容区 center 高亮*/
  bar?: boolean
}

const DRAG_START_THRESHOLD = 5
const DROP_EDGE_THRESHOLD = 0.25
//表头高度：SDockTabbar 里是 34px + 1px 边框，这里按 35px 参与命中与定位（浮窗 bar 同高）
const HEADER_HEIGHT = 35

export default defineComponent({
  name: "SDockWorkspace",
  components: { SDockTabbar, SDockTabDrawer },
  props: {
    items: { type: Array as () => DockItem[], required: true },
    state: { type: Object as () => WorkspaceState, required: true },
    /** 已 detach 到独立窗口的 tab：保留在树里但隐藏（关窗回填时原位置恢复） */
    detachedIds: { type: Object as () => Set<string> | undefined, default: undefined },
    detachEnabled: { type: Boolean, default: false },
    /** 启用悬浮窗组（拖出即浮 + 双击标题切换 + 多 tab 合并）；未启用时 floats 数据被渲染层完全忽略 */
    floatEnabled: { type: Boolean, default: false },
    /** 启用移动模式（导航条 + 单 tab 展示）；由使用方按自己的断点判定传入 */
    isMobile: { type: Boolean, default: false },
    /** 移动模式导航条常驻的快捷 tab id（仅移动分支消费，桌面渲染不受影响） */
    mobileQuickIds: { type: Array as () => string[], default: undefined },
  },
  emits: {
    activate: (_id: string) => true,
    close: (_id: string) => true,
    detach: (_payload: { id: string; screenX: number; screenY: number }) => true,
  },
  setup(props, { emit, expose }) {
    const root = ref<HTMLElement | null>(null)
    const isMobile = computed(() => props.isMobile)
    const rects = computed(() => layoutRects(props.state))
    const itemMap = computed(() => new Map(props.items.map(item => [item.id, item])))
    const groupRectMap = computed(() => new Map(rects.value.groups.map(rect => [rect.groupId, rect])))
    //浮窗内嵌树的百分比矩形：浮窗内的组/分隔条按框架内百分比定位，内容层按它换算 px
    const floatRects = computed(() => new Map((props.state.floats ?? []).map(float => [float.id, layoutRects(float.state)])))

    //悬浮渲染收口：floatEnabled 关闭或移动模式下 floats 数据存在也不渲染（桌面还原后再恢复）
    function findItemFloat(id: string): FloatState | undefined {
      return props.floatEnabled && !isMobile.value ? findFloat(props.state, id) : undefined
    }

    //移动模式合并 tabbar 的条目：全树 DFS + 浮窗顺序（与桌面 Ctrl+Tab 一致），过滤已 detach 的 tab
    const mobileTabItems = computed<TabbarItem[]>(() => {
      if (!isMobile.value) return []
      return allTabIds(props.state)
        .filter(id => !props.detachedIds?.has(id))
        .map(id => itemMap.value.get(id))
        .filter((item): item is DockItem => !!item)
        .map(item => ({ id: item.id, title: item.title, pinned: item.pinned, kind: item.kind }))
    })

    //首次激活才挂载内容，之后常驻（对齐原 STabs pane 的保活语义）。
    //按「组内激活」算而不是全局激活：恢复出的多组布局里每个组的首屏内容要立即挂载，
    //拖拽新建的组（moveTab 造出 newGroup）同样被覆盖
    const everActivated = reactive(new Set<string>())
    watch(
      () => props.state.groups.map(group => group.activeId),
      ids => { for (const id of ids) if (id) everActivated.add(id) },
      { immediate: true, flush: "sync" },
    )
    //浮窗 tab 在浮窗自己的内嵌树里，上面的 watch 覆盖不到（恢复出来的布局、后并入的 tab 都靠这里补挂），
    //不补挂的话浮窗内容是空壳
    watch(
      () => (props.state.floats ?? []).flatMap(float => allTabIds(float.state)),
      ids => { for (const id of ids) if (id) everActivated.add(id) },
      { immediate: true, flush: "sync" },
    )

    //组内 tab 条条目（浮窗内嵌树的组同理）。kind 要透传：使用方的 #tab 插槽
    //（如顶层客户端 tab 的在线/离线徽章）靠它分支渲染
    function groupItems(state: WorkspaceState, groupId: string): TabbarItem[] {
      const group = findGroup(state, groupId)
      if (!group) return []
      return group.tabs
        .map(id => itemMap.value.get(id))
        .filter((item): item is DockItem => !!item)
        .map(item => ({ id: item.id, title: item.title, pinned: item.pinned, kind: item.kind }))
    }

    function focusTab(id: string) {
      activateTabById(props.state, id)
      const float = findItemFloat(id)
      if (float) bringFloatToFront(props.state, float.id)
      emit("activate", id)
    }

    function closeTab(id: string) {
      emit("close", id)
    }

    function itemVisible(item: DockItem): boolean {
      //浮窗内容与停靠内容共用同一批 div（v-show 常驻保活），浮窗内只有所在组的激活 tab 可见
      const float = findItemFloat(item.id)
      if (float) {
        const group = findTabGroup(float.state, item.id)
        return !!group && group.activeId === item.id
      }
      if (props.detachedIds?.has(item.id)) return false
      //移动端只看全局激活：默认多组布局下各组的组内激活 tab 若按桌面逻辑会同时叠显
      if (isMobile.value) return props.state.activeTabId === item.id
      const group = findTabGroup(props.state, item.id)
      return !!group && group.activeId === item.id
    }

    // ↓ 渲染定位

    function groupStyle(rect: GroupRect) {
      return { left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }
    }

    function contentStyle(item: DockItem) {
      //移动模式：激活面板强制满屏，top/height 与合并 tabbar 是否渲染联动（同 35px 表头几何）
      if (isMobile.value) {
        const barHidden = mobileTabItems.value.length <= 1
        return {
          left: "0",
          top: barHidden ? "0" : `${HEADER_HEIGHT}px`,
          width: "100%",
          height: `calc(100% - ${barHidden ? 0 : HEADER_HEIGHT}px)`,
        }
      }
      //浮窗分支：容器相对 px 定位（浮窗原点 + 组矩形换算 px），min() clamp 保证窗口左上角恒在容器内
      const float = findItemFloat(item.id)
      if (float) {
        const floatIndex = Math.max(0, props.state.floats.findIndex(entry => entry.id === float.id))
        const group = findTabGroup(float.state, item.id)
        const rect = group ? floatRects.value.get(float.id)?.groups.find(entry => entry.groupId === group.id) : undefined
        if (!rect) return { display: "none" }
        const left = float.x + (rect.left * float.width) / 100
        const top = float.y + (rect.top * float.height) / 100 + HEADER_HEIGHT
        const width = Math.max(0, (rect.width * float.width) / 100)
        const height = Math.max(0, (rect.height * float.height) / 100 - HEADER_HEIGHT)
        return {
          left: `min(${left}px, calc(100% - 60px))`,
          top: `min(${top}px, calc(100% - ${HEADER_HEIGHT}px))`,
          width: `${width}px`,
          height: `${height}px`,
          zIndex: String(21 + 2 * floatIndex),
        }
      }
      const group = findTabGroup(props.state, item.id)
      const rect = group ? groupRectMap.value.get(group.id) : undefined
      if (!rect) return { display: "none" }
      return {
        left: `${rect.left}%`,
        top: `calc(${rect.top}% + ${HEADER_HEIGHT}px)`,
        width: `${rect.width}%`,
        height: `calc(${rect.height}% - ${HEADER_HEIGHT}px)`,
      }
    }

    function floatFrameStyle(float: FloatState, index: number) {
      return {
        left: `min(${float.x}px, calc(100% - 60px))`,
        top: `min(${float.y}px, calc(100% - ${HEADER_HEIGHT}px))`,
        width: `min(${float.width}px, 100%)`,
        height: `min(${float.height}px, 100%)`,
        zIndex: String(22 + 2 * index),
      }
    }

    function splitStyle(rect: SplitRect) {
      if (rect.direction === "horizontal") {
        return { left: `calc(${rect.boundary}% - 3px)`, top: `${rect.top}%`, width: "6px", height: `${rect.height}%` }
      }
      return { left: `${rect.left}%`, top: `calc(${rect.boundary}% - 3px)`, width: `${rect.width}%`, height: "6px" }
    }

    // ↓ 分隔条拖拽改比例

    function startSplitResize(event: PointerEvent, rect: SplitRect, floatId?: string) {
      //浮窗内的分隔条按浮窗框架做百分比基准，主区分隔条按整个工作区
      const host = floatId ? floatElements.get(floatId) ?? root.value : root.value
      if (!host) return
      const state = floatId ? findFloatById(props.state, floatId)?.state ?? props.state : props.state
      const bounds = host.getBoundingClientRect()
      const move = (next: PointerEvent) => {
        const x = ((next.clientX - bounds.left) / bounds.width) * 100
        const y = ((next.clientY - bounds.top) / bounds.height) * 100
        const ratio = rect.direction === "horizontal"
          ? ((x - rect.left) / rect.width) * 100
          : ((y - rect.top) / rect.height) * 100
        setSplitRatio(state, rect.splitId, ratio)
      }
      const up = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
      }
      ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
    }

    // ↓ tab 拖拽状态机（停靠 tab 条与浮窗 tab 条共用）

    const groupElements = new Map<string, HTMLElement>()
    function setGroupElement(groupId: string, instance: unknown) {
      const element = (instance as { getElement?: () => HTMLElement | null } | null)?.getElement?.() ?? null
      if (element) groupElements.set(groupId, element)
      else groupElements.delete(groupId)
    }

    const floatElements = new Map<string, HTMLElement>()
    function setFloatElement(floatId: string, element: unknown) {
      const element_ = element as HTMLElement | null
      if (element_) floatElements.set(floatId, element_)
      else floatElements.delete(floatId)
    }

    //浮窗内嵌树各组的真实 DOM（命中测试用），按浮窗 id 分桶
    const floatGroupElements = new Map<string, Map<string, HTMLElement>>()
    function setFloatGroupElement(floatId: string, groupId: string, instance: unknown) {
      let bucket = floatGroupElements.get(floatId)
      if (!bucket) {
        bucket = new Map()
        floatGroupElements.set(floatId, bucket)
      }
      const element = (instance as { getElement?: () => HTMLElement | null } | null)?.getElement?.() ?? null
      if (element) bucket.set(groupId, element)
      else bucket.delete(groupId)
    }

    //drop 指示类的收口：主区 floatId 传 undefined，浮窗内组传浮窗 id（防止跨层误匹配）。
    //表头命中（bar）画 tab 条插入竖线，不亮内容区 center——换位的落点在 tab 条上
    function dropClassFor(floatId: string | undefined, groupId: string) {
      const target = dropTarget.value
      if (!target || target.groupId !== groupId || (target.floatId ?? undefined) !== floatId) return {}
      return {
        "drop-left": target.edge === "left",
        "drop-right": target.edge === "right",
        "drop-top": target.edge === "top",
        "drop-bottom": target.edge === "bottom",
        "drop-center": !target.edge && !target.bar,
      }
    }

    //tab 条插入竖线的位置：只认表头命中的落点，返回即将插入的 index（无落点 -1 隐藏）
    function insertIndexFor(floatId: string | undefined, groupId: string) {
      const target = dropTarget.value
      if (!target?.bar || target.groupId !== groupId || (target.floatId ?? undefined) !== floatId) return -1
      return target.index ?? -1
    }

    const draggingId = ref("")
    const dragPoint = ref({ x: 0, y: 0 })
    const dropTarget = ref<DropTarget | null>(null)
    let pointerDrag: { id: string; pointerId: number; startX: number; startY: number; started: boolean } | null = null

    //按鼠标位置算 drop 目标：浮窗自上而下先命中，再查主区；每层内部的组互不重叠。
    //拖 tab：tab 条 = 按位插入；内容区 25% 边缘 = 四向分屏（浮窗内拖 = 浮窗内分屏）；
    //内容中心都不算落点，松手就地浮成新窗（对齐 Unity 中心松手），
    //例外：拖回 tab 自己所在的浮窗 = 原地落回（取消）、空组中心 = 填充。
    //拖整窗：只认其他浮窗的 tab 条和主区组表头——各内容区一律不是落点且不穿透，
    //这是「拖浮窗路过就合并」的防线，对齐 Unity 只在明确落点上才泊靠的手感
    function updatePointerDropTarget(x: number, y: number) {
      dropTarget.value = null
      const floats = props.state.floats ?? []
      for (let i = floats.length - 1; i >= 0; i--) {
        const hit = hitTestGroups(floats[i].state, x, y, floats[i].id)
        if (hit === "inside") return
        if (hit) {
          dropTarget.value = hit
          return
        }
      }
      const mainHit = hitTestGroups(props.state, x, y, undefined)
      if (mainHit && mainHit !== "inside") dropTarget.value = mainHit
    }

    /**一层的组命中测试（floatId 传 undefined 表示主区）。返回落点；
        "inside" = 指针在这层里但当前不构成落点（不穿透到下层）；null = 不在这层*/
    function hitTestGroups(layer: WorkspaceState, x: number, y: number, floatId: string | undefined): DropTarget | "inside" | null {
      const groupRects = floatId ? floatRects.value.get(floatId)?.groups ?? [] : rects.value.groups
      for (const rect of groupRects) {
        const element = floatId
          ? floatGroupElements.get(floatId)?.get(rect.groupId)
          : groupElements.get(rect.groupId)
        if (!element) continue
        const bounds = element.getBoundingClientRect()
        if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue

        //拖动中的浮窗自身整个不是落点，覆盖区域也不穿透
        if (floatDraggingId.value && (floatId ?? "") === floatDraggingId.value) return "inside"

        const headerBottom = Math.min(bounds.bottom, bounds.top + HEADER_HEIGHT)
        if (y <= headerBottom) {
          const tabElements = [...element.querySelectorAll<HTMLElement>(".dock-tab")]
          const hoveredIndex = tabElements.findIndex(tab => {
            const tabBounds = tab.getBoundingClientRect()
            return x <= tabBounds.left + tabBounds.width / 2
          })
          //tab 条 DOM 序即 group.tabs 序（各层内浮 tab 已摘出），无需换算
          return { floatId, groupId: rect.groupId, index: hoveredIndex < 0 ? tabElements.length : hoveredIndex, bar: true }
        }

        if (floatDraggingId.value) return "inside"
        const contentHeight = Math.max(1, bounds.bottom - headerBottom)
        const relativeX = (x - bounds.left) / Math.max(1, bounds.width)
        const relativeY = (y - headerBottom) / contentHeight
        const edge: DropEdge | undefined =
          relativeX < DROP_EDGE_THRESHOLD ? "left"
            : relativeX > 1 - DROP_EDGE_THRESHOLD ? "right"
              : relativeY < DROP_EDGE_THRESHOLD ? "top"
                : relativeY > 1 - DROP_EDGE_THRESHOLD ? "bottom"
                  : undefined
        if (!edge) {
          if (floatId) {
            //其他浮窗的内容中心不算落点：松手就地浮成新窗；
            //拖回 tab 自己所在的组 = 原地落回原位（取消）——只认自己的组，
            //同浮窗内其他组的内容中心同样不算落点（松手就地浮新窗）
            const own = pointerDrag ? findFloat(props.state, pointerDrag.id) : undefined
            if (own?.id !== floatId) return "inside"
            const ownGroup = findTabGroup(layer, pointerDrag!.id)
            if (ownGroup && ownGroup.id !== rect.groupId) return "inside"
            return { floatId, groupId: ownGroup?.id ?? rect.groupId, index: ownGroup ? ownGroup.tabs.indexOf(pointerDrag!.id) : undefined }
          }
          //主区中心不算落点：松手就地浮成新窗；空组例外——中心 = 填充（"把 tab 拖到这里"的唯一入口）
          const group = findGroup(layer, rect.groupId)
          if (group?.tabs.length) return "inside"
        }
        return { floatId, groupId: rect.groupId, edge }
      }
      return null
    }

    function startPointerDrag(event: PointerEvent, id: string) {
      if (event.button !== 0) return
      pointerDrag = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false }
      dragPoint.value = { x: event.clientX, y: event.clientY }
      ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
      window.addEventListener("pointermove", onPointerDragMove, { passive: false })
      window.addEventListener("pointerup", finishPointerDrag)
      window.addEventListener("pointercancel", cancelPointerDrag)
    }

    function onPointerDragMove(event: PointerEvent) {
      const drag = pointerDrag
      if (!drag || event.pointerId !== drag.pointerId) return
      if (!drag.started) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_START_THRESHOLD) return
        drag.started = true
        draggingId.value = drag.id
      }
      event.preventDefault()
      dragPoint.value = { x: event.clientX, y: event.clientY }
      updatePointerDropTarget(event.clientX, event.clientY)
    }

    function removePointerListeners() {
      window.removeEventListener("pointermove", onPointerDragMove)
      window.removeEventListener("pointerup", finishPointerDrag)
      window.removeEventListener("pointercancel", cancelPointerDrag)
    }

    function resetPointerDrag() {
      removePointerListeners()
      pointerDrag = null
      draggingId.value = ""
      dropTarget.value = null
    }

    function isOutOfViewport(x: number, y: number): boolean {
      return x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight
    }

    function finishPointerDrag(event: PointerEvent) {
      const drag = pointerDrag
      if (!drag || event.pointerId !== drag.pointerId) return
      if (!drag.started) {
        resetPointerDrag()
        return
      }
      const target = dropTarget.value
      if (target?.groupId) {
        //落点所在层的状态：floatId 指向浮窗（内嵌树），无 floatId 是主树
        const targetState = target.floatId ? findFloatById(props.state, target.floatId)?.state : props.state
        const sourceState = findTabOwnerState(props.state, drag.id)
        if (targetState) {
          if (sourceState && sourceState !== targetState) {
            //跨层移动（主区 ↔ 浮窗、浮窗 ↔ 浮窗）：先拔出再插入；带 edge 则在目标层内四向分屏。
            //pluckTab 必须传顶层 state——内嵌 state 里查不到浮窗条目，搬空后清理不了会留孤儿空壳
            pluckTab(props.state, drag.id)
            insertTab(targetState, drag.id, target.groupId, target.index, target.edge)
          } else {
            moveTab(targetState, drag.id, target.groupId, target.index, target.edge)
          }
          focusTab(drag.id)
        }
      } else {
        const item = itemMap.value.get(drag.id)
        const outOfViewport = isOutOfViewport(event.clientX, event.clientY)
        if (item?.detachable && props.detachEnabled && outOfViewport) {
          emit("detach", { id: drag.id, screenX: event.screenX, screenY: event.screenY })
        } else if (props.floatEnabled && !isMobile.value) {
          //拖出所有落点（仍在窗口内）松手 → 悬浮成新窗；从浮窗拖出的 tab 也走这里
          //（floatTab 对已浮 tab 是「摘出重浮」，等效拖出旧窗建新窗）
          const bounds = root.value?.getBoundingClientRect()
          floatTab(props.state, drag.id, {
            x: event.clientX - (bounds?.left ?? 0),
            y: event.clientY - (bounds?.top ?? 0),
            width: FLOAT_DEFAULT_WIDTH,
            height: FLOAT_DEFAULT_HEIGHT,
          })
          everActivated.add(drag.id)
          const created = findFloat(props.state, drag.id)
          if (created) bringFloatToFront(props.state, created.id)
          emit("activate", drag.id)
        }
      }
      resetPointerDrag()
    }

    function cancelPointerDrag() {
      resetPointerDrag()
    }

    // ↓ 悬浮窗组：整窗拖动 / 右下角缩放 / 合并与回收

    const floatDraggingId = ref("")
    let floatDrag: { id: string; pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; started: boolean } | null = null

    /**整窗拖动：5px 阈值防误触；落点规则见 updatePointerDropTarget（只认 tab 条/组表头）*/
    function startFloatDrag(event: PointerEvent, floatId: string) {
      if (event.button !== 0) return
      const bounds = root.value?.getBoundingClientRect()
      const float = findFloatById(props.state, floatId)
      if (!bounds || !float) return
      focusTab(float.state.activeTabId)
      floatDrag = {
        id: floatId,
        pointerId: event.pointerId,
        started: false,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - bounds.left - float.x,
        offsetY: event.clientY - bounds.top - float.y,
      }
      ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
      window.addEventListener("pointermove", onFloatDragMove, { passive: false })
      window.addEventListener("pointerup", finishFloatDrag)
      window.addEventListener("pointercancel", cancelFloatDrag)
    }

    function onFloatDragMove(event: PointerEvent) {
      const drag = floatDrag
      if (!drag || event.pointerId !== drag.pointerId) return
      if (!drag.started) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_START_THRESHOLD) return
        drag.started = true
        floatDraggingId.value = drag.id
      }
      event.preventDefault()
      const bounds = root.value?.getBoundingClientRect()
      if (!bounds) return
      updateFloatRect(props.state, drag.id, {
        x: event.clientX - bounds.left - drag.offsetX,
        y: event.clientY - bounds.top - drag.offsetY,
      })
      updatePointerDropTarget(event.clientX, event.clientY)
    }

    function finishFloatDrag(event: PointerEvent) {
      const drag = floatDrag
      if (!drag || event.pointerId !== drag.pointerId) return
      removeFloatListeners()
      const started = drag.started
      const dragId = drag.id
      floatDrag = null
      floatDraggingId.value = ""
      const target = started ? dropTarget.value : null
      dropTarget.value = null
      if (!target) return
      const dragged = findFloatById(props.state, dragId)
      if (!dragged) return
      const activeId = dragged.state.activeTabId
      //落点层的状态：floatId 指向其他浮窗（内嵌树），无 floatId 是主树；落点必带 groupId（tab 条/表头）
      const targetState = target.floatId ? findFloatById(props.state, target.floatId)?.state : props.state
      if (targetState && target.groupId) {
        //整窗并入目标组表头插入位：按 DFS 序拔出/插入，保持 tab 顺序与原激活，落点 index 逐个递增
        const tabs = allTabIds(dragged.state)
        let index = target.index
        for (const tabId of tabs) {
          //传顶层 state：最后一次 pluck 搬空浮窗时顺带移除条目
          pluckTab(props.state, tabId)
          insertTab(targetState, tabId, target.groupId, index)
          if (index != null) index += 1
        }
        //全部搬空后移除被拖浮窗的条目
        if (!allTabIds(dragged.state).length) removeFloatEntry(props.state, dragId)
        focusTab(activeId)
      }
    }

    function cancelFloatDrag() {
      removeFloatListeners()
      floatDrag = null
      floatDraggingId.value = ""
      dropTarget.value = null
    }

    function removeFloatListeners() {
      window.removeEventListener("pointermove", onFloatDragMove)
      window.removeEventListener("pointerup", finishFloatDrag)
      window.removeEventListener("pointercancel", cancelFloatDrag)
    }

    function startFloatResize(event: PointerEvent, floatId: string) {
      if (event.button !== 0) return
      const bounds = root.value?.getBoundingClientRect()
      const float = findFloatById(props.state, floatId)
      if (!bounds || !float) return
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return
        moveEvent.preventDefault()
        updateFloatRect(props.state, floatId, {
          width: moveEvent.clientX - bounds.left - float.x,
          height: moveEvent.clientY - bounds.top - float.y,
        })
      }
      const up = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
        window.removeEventListener("pointercancel", up)
      }
      ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
      window.addEventListener("pointercancel", up)
    }

    /**双击停靠 tab 标题 → 浮起；双击浮窗 tab → 回停靠；双击浮窗 tab 条空白 → 整窗回停靠*/
    function toggleFloat(id: string) {
      if (!props.floatEnabled || isMobile.value) return
      if (isFloating(props.state, id)) {
        unfloat(id)
        return
      }
      const bounds = root.value?.getBoundingClientRect()
      const tabElement = groupElements.get(findTabGroup(props.state, id)?.id ?? "")
        ?.querySelector<HTMLElement>(`.dock-tab[data-tab-id="${CSS.escape(id)}"]`)
      const tabRect = tabElement?.getBoundingClientRect()
      floatTab(props.state, id, {
        x: tabRect && bounds ? tabRect.left - bounds.left : 40,
        y: tabRect && bounds ? tabRect.bottom - bounds.top + 4 : 40,
        width: FLOAT_DEFAULT_WIDTH,
        height: FLOAT_DEFAULT_HEIGHT,
      })
      everActivated.add(id)
      const created = findFloat(props.state, id)
      if (created) bringFloatToFront(props.state, created.id)
      emit("activate", id)
    }

    function unfloat(id: string) {
      unfloatTab(props.state, id)
      focusTab(id)
    }

    /**整窗回停靠（双击浮窗 tab 条空白处触发）*/
    function unfloatFloat(floatId: string) {
      const activeId = dockFloat(props.state, floatId)
      if (activeId) focusTab(activeId)
    }

    function isFloatContentDragging(id: string): boolean {
      if (!floatDraggingId.value) return false
      const float = findItemFloat(id)
      return !!float && float.id === floatDraggingId.value
    }

    const ghostWillFloat = computed(() =>
      !!draggingId.value && !dropTarget.value && props.floatEnabled && !isMobile.value
      && !isOutOfViewport(dragPoint.value.x, dragPoint.value.y))

    onBeforeUnmount(() => {
      resetPointerDrag()
      removeFloatListeners()
      groupElements.clear()
      floatElements.clear()
      floatGroupElements.clear()
    })

    expose({
      /** 把 tab 放回工作区并激活（detach 关窗回填用；已在树里/浮窗里则只激活） */
      restoreTab(id: string) {
        if (!findTabGroup(props.state, id) && !isFloating(props.state, id)) addTab(props.state, id)
        focusTab(id)
      },
      activate: focusTab,
    })

    return {
      root,
      isMobile,
      rects,
      itemMap,
      mobileTabItems,
      floatRects,
      groupItems,
      focusTab,
      closeTab,
      itemVisible,
      groupStyle,
      contentStyle,
      floatFrameStyle,
      splitStyle,
      startSplitResize,
      setGroupElement,
      setFloatElement,
      setFloatGroupElement,
      draggingId,
      dragPoint,
      dropTarget,
      startPointerDrag,
      findGroup,
      setSplitRatio,
      everActivated,
      floatDraggingId,
      startFloatDrag,
      startFloatResize,
      unfloat,
      unfloatFloat,
      dropClassFor,
      insertIndexFor,
      isFloatContentDragging,
      toggleFloat,
      ghostWillFloat,
    }
  },
})
</script>
<style scoped>
.dock-workspace {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
/*移动模式：导航条走 flex 流、内容区绝对定位满屏（contentStyle 已按 35px 表头让位）*/
.dock-workspace.mobile { display: flex; flex-direction: column; }
.dock-workspace.mobile .dock-mobile-bar { flex: 0 0 auto; }
.dock-group {
  position: absolute;
  z-index: 4;
  min-width: 0;
  min-height: 0;
  pointer-events: none;
}
/*平时命中测试走内容区，只有拖拽中才让组接收指针（tab 条除外，它要常驻可点）*/
.dock-group :deep(.dock-tabbar-list) { pointer-events: auto; }
.dock-workspace.dragging .dock-group { z-index: 6; pointer-events: auto; }
.dock-group-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--sui-fg-muted);
  font-size: 12px;
}
.dock-content {
  position: absolute;
  z-index: 3;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--sui-bg);
}
.dock-content > * { width: 100%; height: 100%; }

/*悬浮窗组：只画外壳，z 序 22+2i 高于自己内容（21+2i）——边框/tab条/手柄盖在内容上，
  中段 pointer-events: none 让点击穿透到内容，bar 与手柄单独开。
  拖动中整体半透明：既能看到下方落点指示，也明确「正在拖动」*/
.dock-float-frame {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--sui-border);
  background: transparent;
  box-shadow: var(--sui-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.35));
  pointer-events: none;
}
.dock-float-frame.frame-dragging { opacity: 0.75; }
.dock-float-frame.drop-float { border-color: var(--sui-primary); }
/*浮窗内的组 tab 条常驻可点（同主区 .dock-group 规则），分隔条与缩放手柄也要单独开：
  框架本体 pointer-events: none 让中段点击穿透到内容层*/
.dock-float-frame .dock-resizer { pointer-events: auto; }
.dock-float-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  pointer-events: auto;
  cursor: nwse-resize;
  touch-action: none;
}
.dock-float-resize::after {
  content: "";
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--sui-fg-muted);
  border-bottom: 2px solid var(--sui-fg-muted);
}
.dock-content.float-content-dragging { opacity: 0.75; }
.dock-resizer {
  position: absolute;
  z-index: 8;
  touch-action: none;
}
.dock-resizer.horizontal { cursor: col-resize; }
.dock-resizer.vertical { cursor: row-resize; }
.dock-resizer::after {
  content: "";
  position: absolute;
  inset: 2px;
  background: var(--sui-border);
}
.dock-resizer:hover::after { background: var(--sui-primary); }
.dock-drop-indicator {
  position: absolute;
  z-index: 10;
  display: none;
  pointer-events: none;
  border: 2px solid var(--sui-primary);
  background: color-mix(in srgb, var(--sui-primary) 18%, transparent);
}
.drop-left .dock-drop-indicator { display: block; inset: 0 50% 0 0; }
.drop-right .dock-drop-indicator { display: block; inset: 0 0 0 50%; }
.drop-top .dock-drop-indicator { display: block; inset: 0 0 50%; }
.drop-bottom .dock-drop-indicator { display: block; inset: 50% 0 0; }
.drop-center .dock-drop-indicator { display: block; inset: 35px 0 0; }
.dock-drag-ghost {
  position: fixed;
  z-index: 100;
  max-width: 260px;
  padding: 7px 12px;
  overflow: hidden;
  pointer-events: none;
  border: 1px solid var(--sui-primary);
  border-radius: var(--sui-radius-sm);
  background: var(--sui-bg-hover);
  color: var(--sui-fg);
  box-shadow: var(--sui-shadow-sm);
  /*半透明：拖动经过 tab 条时不至于把落点附近的 tab 名整个盖住*/
  opacity: 0.85;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/*拖出落点的 ghost 提示：松手将悬浮成新窗（虚线边框区分于普通拖拽）*/
.dock-drag-ghost.will-float {
  border-style: dashed;
}
</style>
