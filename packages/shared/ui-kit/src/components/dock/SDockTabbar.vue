<template>
  <section ref="root" class="dock-tabbar" :class="{ focused }">
    <div ref="list" class="dock-tabbar-list" @pointerdown="onListPointerDown" @dblclick="onListDblClick">
      <div
        v-for="item in items"
        :key="item.id"
        class="dock-tab"
        :data-tab-id="item.id"
        :class="{ active: item.id === activeId }"
        @pointerenter="SyncTooltip($event, item)"
        @pointerleave="ClearTooltip($event)"
        @click="emit('activate', item.id)"
        @dblclick.stop="emit('toggle-float', item.id)"
        @pointerdown="emit('start-drag', $event, item.id)"
      >
        <!--tab 头内容（状态徽标/关闭/新窗口按钮）由使用方渲染，兜底显示标题-->
        <slot name="tab" :item="item">
          <span class="dock-tab-title s-truncate">{{ item.title }}</span>
        </slot>
        <s-icon-button v-if="!item.pinned" :size="18" title="关闭" aria-label="关闭" @pointerdown.stop @click.stop="emit('close', item.id)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </s-icon-button>
      </div>
      <div v-if="insertIndex >= 0" class="dock-tab-insert" :style="insertStyle"></div>
    </div>
    <div class="dock-tabbar-body">
      <slot></slot>
    </div>
  </section>
</template>
<script lang="ts">
//工作区的组内 tab 条：只负责展示和发出交互事件，拖拽状态机、drop 命中都在 DockWorkspace。
//结构上对应 sterm 的 TabShell，去掉了右键菜单和 i18n。
import { computed, defineComponent, ref } from "vue";

export interface TabbarItem {
  id: string
  title: string
  pinned?: boolean
  /** 透传 DockItem.kind，供使用方的 #tab 插槽区分客户端/快照等渲染分支 */
  kind?: string
}

export default defineComponent({
  name: "SDockTabbar",
  props: {
    items: { type: Array as () => TabbarItem[], required: true },
    activeId: { type: String, default: "" },
    focused: { type: Boolean, default: false },
    /**拖拽经过时的插入位指示（竖线画在 tab 之间）：-1 隐藏。位置由父组件按落点判定给*/
    insertIndex: { type: Number, default: -1 },
  },
  emits: {
    activate: (_id: string) => true,
    close: (_id: string) => true,
    //pointerdown 即上报，是否真的进入拖拽由 SDockWorkspace 的 5px 阈值决定
    "start-drag": (_event: PointerEvent, _id: string) => true,
    //双击标题切换悬浮；是否生效由 SDockWorkspace 的 floatEnabled 决定
    "toggle-float": (_id: string) => true,
    //tab 条空白处按下/双击（浮窗里用作整窗拖动/整窗回收；停靠组由使用方决定是否消费）
    "bar-drag": (_event: PointerEvent) => true,
    "bar-dblclick": () => true,
  },
  setup(props, { emit }) {
    const root = ref<HTMLElement | null>(null)
    const list = ref<HTMLElement | null>(null)
    //插入竖线的横向位置：index 处 tab 的左缘，末尾则取最后一个 tab 的右缘。
    //按内容坐标算（补回 scrollLeft），列表滚动时竖线跟着内容走
    const insertStyle = computed(() => {
      const listEl = list.value
      if (!listEl || props.insertIndex < 0) return {}
      const listLeft = listEl.getBoundingClientRect().left
      const tabs = [...listEl.querySelectorAll<HTMLElement>(".dock-tab")]
      let x: number
      if (tabs.length === 0) x = 0
      else if (props.insertIndex >= tabs.length) x = tabs[tabs.length - 1].getBoundingClientRect().right - listLeft
      else x = tabs[props.insertIndex].getBoundingClientRect().left - listLeft
      return { left: `${Math.round(x + listEl.scrollLeft)}px` }
    })
    //drop 命中测试需要组的真实 DOM rect（tab 条 hit-test 也要真实元素），由父组件取
    const getElement = () => root.value
    //只认空白处：tab/关闭钮上的按下与双击走各自的事件
    const onListPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.(".dock-tab")) return
      emit("bar-drag", event)
    }
    const onListDblClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.(".dock-tab")) return
      emit("bar-dblclick")
    }
    //原生 tooltip 只在文本真的被截断时才挂：平时悬停不弹框遮住下面的 tab/内容，
    //被 ellipsis 截断的长名（如顶层客户端的 uuid）悬停时仍能看到全名
    const SyncTooltip = (event: PointerEvent, item: TabbarItem) => {
      const host = event.currentTarget as HTMLElement
      const labels = host.querySelectorAll<HTMLElement>("span")
      const truncated = [...labels].some(span => span.scrollWidth > span.clientWidth + 1)
      if (truncated) host.setAttribute("title", item.title)
      else host.removeAttribute("title")
    }
    const ClearTooltip = (event: PointerEvent) => {
      ;(event.currentTarget as HTMLElement).removeAttribute("title")
    }
    return { root, list, insertStyle, emit, getElement, SyncTooltip, ClearTooltip, onListPointerDown, onListDblClick }
  },
})
</script>
<style scoped>
/* 表头 34px + 1px 边框 = 35px：SDockWorkspace 的 drop 命中与内容定位都按 35px 算，两边不能脱钩 */
.dock-tabbar {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border: 1px solid var(--sui-border);
  /*背景必须透明：组容器 z 序高于内容层（dock-content z-3），不透明会把组内 tab 的内容全挡住
    （sterm 原版 .tab-shell 同样是 transparent），背景只留在 tab 条列表上*/
  background: transparent;
}
.dock-tabbar-list {
  position: relative;
  display: flex;
  height: 34px;
  min-width: 0;
  flex: 0 0 auto;
  overflow-x: auto;
  /*不画底边分隔线：active tab 自带 2px 指示线，再叠一条横贯的灰线会错位成双线；
    组容器四边已有 1px 边框兜住区域边界（表头总高 34+1=35px 的几何不变）*/
  background: var(--sui-bg);
  scrollbar-width: thin;
}
/*焦点组不画额外指示：active tab 的 2px 指示线 + 内容本身已经足够分辨焦点，
  再叠一条横贯表头的蓝线会在组与组之间显得突兀*/
/*视觉对齐 ui-kit 的 .s-tab-button：轻量块 + 底部 2px 指示线，不用 sterm 的终端块状风格*/
.dock-tab {
  display: flex;
  min-width: 0;
  max-width: 240px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--sui-fg-muted);
  cursor: pointer;
  touch-action: none;
  user-select: none;
  white-space: nowrap;
}
.dock-tab:hover { background: var(--sui-bg-hover); color: var(--sui-fg); }
.dock-tab.active { border-bottom-color: var(--sui-primary); color: var(--sui-primary); }
.dock-tab-title {
  flex: 1;
}
.dock-tabbar-body {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
/*插入位指示线：2px 竖线骑在插入边界上（margin-left 负半宽居中），top/bottom 留缝不顶满，
  与 active tab 的 2px 指示线同色——同一根线，拖拽时表示「将插入这里」*/
.dock-tab-insert {
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 2px;
  margin-left: -1px;
  background: var(--sui-primary);
  pointer-events: none;
  z-index: 1;
}
</style>
