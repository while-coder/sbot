<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { StoredMessage, ChatLabels } from '../types'
import { resolveLabels } from '../labels'
import MessageList from './MessageList.vue'

const props = withDefaults(defineProps<{
  thinksUrlPrefix: string
  labels?: ChatLabels
  fetchFn?: (url: string) => Promise<any>
}>(), {
  fetchFn: undefined,
})

const L = computed(() => resolveLabels(props.labels))

const visible = ref(false)
const thinkStack = ref<{ id: string; messages: StoredMessage[]; loading: boolean }[]>([])
const drawerEl = ref<HTMLElement | null>(null)

function doFetch(url: string): Promise<any> {
  if (props.fetchFn) return props.fetchFn(url)
  return fetch(url).then(r => r.json())
}

async function open(thinkId: string) {
  const existing = thinkStack.value.find(s => s.id === thinkId)
  if (existing) return

  thinkStack.value.push({ id: thinkId, messages: [] as StoredMessage[], loading: true })
  visible.value = true

  const layer = thinkStack.value[thinkStack.value.length - 1]
  try {
    const res = await doFetch(`${props.thinksUrlPrefix}/${encodeURIComponent(thinkId)}`)
    layer.messages = res.data || []
  } catch {
    layer.messages = []
  } finally {
    layer.loading = false
  }
  await nextTick()
  if (drawerEl.value) {
    drawerEl.value.scrollTop = drawerEl.value.scrollHeight
  }
}

function popLayer() {
  thinkStack.value.pop()
  if (thinkStack.value.length === 0) visible.value = false
}

function close() {
  visible.value = false
  thinkStack.value = []
}

function onNestedThink(thinkId: string) {
  open(thinkId)
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <Transition name="think-drawer">
      <div v-if="visible" class="think-drawer-backdrop" @click="close">
        <div class="think-drawer" ref="drawerEl" @click.stop>
          <div class="think-drawer-header">
            <button v-if="thinkStack.length > 1" class="think-drawer-back" @click="popLayer">←</button>
            <span class="think-drawer-title">
              {{ L.think }}
              <span v-if="thinkStack.length > 1" class="think-drawer-depth">({{ thinkStack.length }} layers)</span>
            </span>
            <button class="think-drawer-close" @click="close">×</button>
          </div>

          <div v-if="thinkStack.length > 1" class="think-drawer-breadcrumb">
            <span v-for="(layer, i) in thinkStack" :key="layer.id" class="think-breadcrumb-item">
              <span v-if="i > 0" class="think-breadcrumb-sep">›</span>
              <span :class="{ active: i === thinkStack.length - 1 }">Think #{{ i + 1 }}</span>
            </span>
          </div>

          <div class="think-drawer-body">
            <template v-if="thinkStack.length > 0">
              <div v-if="thinkStack[thinkStack.length - 1].loading" class="think-drawer-loading">
                {{ L.loading }}
              </div>
              <MessageList
                v-else
                :messages="thinkStack[thinkStack.length - 1].messages"
                :thinks-url-prefix="thinksUrlPrefix"
                :labels="labels"
                :fetch-fn="fetchFn"
                :on-think-click="onNestedThink"
              />
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.think-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
}
.think-drawer {
  width: min(560px, 85vw);
  height: 100%;
  background: var(--chatui-bg-surface, var(--vscode-editor-background, #fff));
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.think-drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--chatui-border, var(--vscode-widget-border, #e5e7eb));
  flex-shrink: 0;
}
.think-drawer-title {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  color: var(--chatui-fg-primary, var(--vscode-foreground, #374151));
}
.think-drawer-depth {
  font-weight: 400;
  font-size: 12px;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #9ca3af));
  margin-left: 4px;
}
.think-drawer-back,
.think-drawer-close {
  background: none;
  border: 1px solid var(--chatui-border, var(--vscode-widget-border, #e5e7eb));
  border-radius: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 16px;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #6b7280));
  flex-shrink: 0;
}
.think-drawer-back:hover,
.think-drawer-close:hover {
  background: var(--chatui-bg-ai, var(--vscode-list-hoverBackground, #f3f4f6));
  color: var(--chatui-fg-primary, var(--vscode-foreground, #374151));
}
.think-drawer-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 16px;
  font-size: 11px;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #9ca3af));
  border-bottom: 1px solid var(--chatui-border, var(--vscode-widget-border, #f3f4f6));
  flex-shrink: 0;
}
.think-breadcrumb-sep { margin: 0 2px; }
.think-breadcrumb-item .active {
  color: var(--chatui-fg-primary, var(--vscode-foreground, #374151));
  font-weight: 500;
}
.think-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.think-drawer-loading {
  text-align: center;
  color: var(--chatui-fg-secondary, var(--vscode-descriptionForeground, #9ca3af));
  padding: 40px 0;
  font-size: 13px;
}

/* Transitions */
.think-drawer-enter-active,
.think-drawer-leave-active { transition: opacity 0.2s ease; }
.think-drawer-enter-active .think-drawer,
.think-drawer-leave-active .think-drawer { transition: transform 0.25s ease; }
.think-drawer-enter-from,
.think-drawer-leave-to { opacity: 0; }
.think-drawer-enter-from .think-drawer,
.think-drawer-leave-to .think-drawer { transform: translateX(-100%); }
</style>
