<template>
  <!--移动模式的导航条：汉堡按钮 + 快捷 tab（高频面板常驻，一击直达）+ 当前激活 tab 名
      （激活项是快捷 tab 时不重复显示）。其余面板点开抽屉选。几何与 SDockTabbar 对齐：
      34px + 1px 边框 = 35px（SDockWorkspace 的 contentStyle 按 35px 让位，两边不能脱钩）-->
  <div class="dock-mobile-bar">
    <button
      class="dock-mobile-burger"
      type="button"
      :aria-expanded="open"
      aria-label="打开面板菜单"
      @click="open = !open"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </svg>
    </button>
    <button
      v-for="item in quickItems"
      :key="item.id"
      class="dock-mobile-quick"
      :class="{ active: item.id === activeId }"
      type="button"
      @click="activate(item.id)"
    >
      <slot name="tab" :item="item">
        <span class="dock-mobile-quick-title">{{ item.title }}</span>
      </slot>
    </button>
    <button v-if="!activeIsQuick && activeItem" class="dock-mobile-current" type="button" title="打开面板菜单" @click="open = true">
      <slot name="tab" :item="activeItem">
        <span class="dock-mobile-current-title">{{ activeItem.title }}</span>
      </slot>
    </button>
    <span v-else-if="!activeIsQuick" class="dock-mobile-current dock-mobile-placeholder">面板</span>

    <!--抽屉 Teleport 到 body：fixed 定位不依赖祖先没有 transform，z 序也独立于工作区内部层级-->
    <Teleport to="body">
      <Transition name="dock-drawer">
        <div v-if="open" class="dock-drawer-mask" @click="open = false" @wheel.prevent>
          <nav ref="drawerEl" class="dock-drawer" role="dialog" aria-modal="true" aria-label="面板菜单" @click.stop @touchmove.stop>
            <div
              v-for="item in items"
              :key="item.id"
              class="dock-drawer-row"
              :class="{ active: item.id === activeId }"
              :title="item.title"
            >
              <button class="dock-drawer-item" type="button" @click="activate(item.id)">
                <slot name="tab" :item="item">
                  <span class="dock-drawer-title">{{ item.title }}</span>
                </slot>
              </button>
              <button
                v-if="!item.pinned"
                class="dock-drawer-close"
                type="button"
                aria-label="关闭"
                @click.stop="emit('close', item.id)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </nav>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
<script lang="ts">
//移动端 SDockWorkspace 的合并导航：一条汉堡条 + 全屏抽屉列出所有 tab（树 DFS 序）。
//只负责展示和交互，激活/关闭语义与桌面 tabbar 一致，走同样的 activate/close 事件
import { computed, defineComponent, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { TabbarItem } from "./SDockTabbar.vue";

export default defineComponent({
  name: "SDockTabDrawer",
  props: {
    items: { type: Array as () => TabbarItem[], required: true },
    activeId: { type: String, default: "" },
    /** 常驻导航条的快捷 tab id（按传入顺序展示；不在 items 里的自动忽略），其余面板走抽屉 */
    quickIds: { type: Array as () => string[], default: undefined },
  },
  emits: {
    activate: (_id: string) => true,
    close: (_id: string) => true,
  },
  setup(props, { emit }) {
    const open = ref(false)
    const drawerEl = ref<HTMLElement | null>(null)
    const activeItem = computed(() => props.items.find(item => item.id === props.activeId))
    const quickItems = computed(() =>
      (props.quickIds ?? [])
        .map(id => props.items.find(item => item.id === id))
        .filter((item): item is TabbarItem => !!item),
    )
    const activeIsQuick = computed(() => quickItems.value.some(item => item.id === props.activeId))

    const activate = (id: string) => {
      open.value = false
      emit("activate", id)
    }
    const OnKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") open.value = false
    }
    //打开时挂 Escape 关闭，并把激活行滚进可视区（面板多时激活项可能在很靠下的位置）
    watch(open, async value => {
      if (value) {
        window.addEventListener("keydown", OnKeydown)
        await nextTick()
        drawerEl.value?.querySelector(".dock-drawer-row.active")?.scrollIntoView({ block: "center" })
      } else {
        window.removeEventListener("keydown", OnKeydown)
      }
    })
    onBeforeUnmount(() => window.removeEventListener("keydown", OnKeydown))

    return { open, drawerEl, activeItem, quickItems, activeIsQuick, activate, emit }
  },
})
</script>
<style scoped>
.dock-mobile-bar {
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
  height: 34px;
  align-items: stretch;
  border-bottom: 1px solid var(--sui-border);
  background: var(--sui-bg);
}
.dock-mobile-burger {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--sui-fg-muted);
  cursor: pointer;
}
.dock-mobile-burger:hover { background: var(--sui-bg-hover); color: var(--sui-fg); }
.dock-mobile-burger:focus-visible { outline: 2px solid var(--sui-primary); outline-offset: -2px; }
/*快捷 tab：视觉对齐 .dock-tab 的轻量块 + 底部 2px 指示线；挤的时候先压缩右侧名称区*/
.dock-mobile-quick {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  padding: 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--sui-fg-muted);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.dock-mobile-quick:hover { background: var(--sui-bg-hover); color: var(--sui-fg); }
.dock-mobile-quick.active { border-bottom-color: var(--sui-primary); color: var(--sui-primary); }
.dock-mobile-quick-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dock-mobile-current {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--sui-fg);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.dock-mobile-current:hover { background: var(--sui-bg-hover); }
.dock-mobile-current-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dock-mobile-placeholder { color: var(--sui-fg-muted); cursor: default; }

.dock-drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgb(0 0 0 / 40%);
}
.dock-drawer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(78vw, 300px);
  padding: 6px 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-right: 1px solid var(--sui-border);
  background: var(--sui-bg);
  box-shadow: var(--sui-shadow-sm);
}
.dock-drawer-row {
  display: flex;
  min-height: 44px;
  align-items: stretch;
}
.dock-drawer-row.active {
  background: color-mix(in srgb, var(--sui-primary) 10%, transparent);
  box-shadow: inset 2px 0 0 var(--sui-primary);
}
.dock-drawer-item {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border: 0;
  background: transparent;
  color: var(--sui-fg);
  cursor: pointer;
  font-size: 14px;
  text-align: left;
}
.dock-drawer-item:hover { background: var(--sui-bg-hover); }
.dock-drawer-row.active .dock-drawer-item { color: var(--sui-primary); }
.dock-drawer-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dock-drawer-close {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 30px;
  margin-right: 6px;
  padding: 0;
  border: 0;
  border-radius: var(--sui-radius-sm);
  background: transparent;
  color: var(--sui-fg-muted);
  cursor: pointer;
}
.dock-drawer-close:hover { background: var(--sui-bg-hover); color: var(--sui-fg); }

.dock-drawer-enter-active,
.dock-drawer-leave-active { transition: opacity 0.18s ease; }
.dock-drawer-enter-active .dock-drawer,
.dock-drawer-leave-active .dock-drawer { transition: transform 0.18s ease; }
.dock-drawer-enter-from,
.dock-drawer-leave-to { opacity: 0; }
.dock-drawer-enter-from .dock-drawer,
.dock-drawer-leave-to .dock-drawer { transform: translateX(-100%); }
</style>
