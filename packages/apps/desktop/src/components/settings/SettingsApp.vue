<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import GeneralPage from './pages/GeneralPage.vue'
import ModelsPage from './pages/ModelsPage.vue'
import ChannelsPage from './pages/ChannelsPage.vue'
import AboutPage from './pages/AboutPage.vue'

type PageKey = 'general' | 'models' | 'channels' | 'about'

const NAV: Array<{ key: PageKey; label: string; desc: string }> = [
  { key: 'general', label: '常规', desc: '外观与基础行为' },
  { key: 'models', label: '模型', desc: 'LLM 模型接入' },
  { key: 'channels', label: '渠道', desc: '消息渠道接入' },
  { key: 'about', label: '关于', desc: '版本与诊断' },
]

function parseInitialPage(): PageKey {
  // 窗口 URL 若带 hash 参数（index.html#/settings?page=models）则直接解析
  const m = window.location.hash.match(/[?&]page=(\w+)/)
  return m && NAV.some(n => n.key === m[1]) ? (m[1] as PageKey) : 'general'
}

const active = ref<PageKey>(parseInitialPage())

// Rust 侧创建窗口时记录的初始页（一次性取走，规避事件早于监听的竞态）
void invoke<string | null>('get_settings_initial_page')
  .then((page) => {
    if (page && NAV.some(n => n.key === page)) active.value = page as PageKey
  })
  .catch(() => { /* 命令尚未就绪时忽略，hash 解析已兜底 */ })

const unlistenPromise = listen<{ page?: string }>('settings://navigate', (e) => {
  const page = e.payload?.page
  if (page && NAV.some(n => n.key === page)) active.value = page as PageKey
})

onUnmounted(() => void unlistenPromise.then(unlisten => unlisten()))
</script>

<template>
  <div class="settings-app">
    <aside class="nav">
      <div class="nav-title">设置</div>
      <button
        v-for="item in NAV"
        :key="item.key"
        class="nav-item"
        :class="{ active: active === item.key }"
        type="button"
        @click="active = item.key"
      >
        <span class="nav-label">{{ item.label }}</span>
        <span class="nav-desc">{{ item.desc }}</span>
      </button>
    </aside>

    <main class="content">
      <GeneralPage v-show="active === 'general'" />
      <ModelsPage v-show="active === 'models'" />
      <ChannelsPage v-show="active === 'channels'" />
      <AboutPage v-show="active === 'about'" />
    </main>
  </div>
</template>

<style scoped>
.settings-app {
  height: 100vh;
  display: flex;
  overflow: hidden;
  background: var(--sui-bg, #fff);
  color: var(--sui-fg, #1f2328);
}
.nav {
  width: 200px;
  flex-shrink: 0;
  padding: 16px 10px;
  border-right: 1px solid var(--sui-border, #e5e7eb);
  background: var(--sui-bg-subtle, #f6f7f8);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.nav-title {
  font-size: 15px;
  font-weight: 700;
  padding: 0 10px 12px;
}
.nav-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font-size: 13px;
}
.nav-item:hover {
  background: var(--sui-bg-hover, #ececee);
}
.nav-item.active {
  background: var(--sui-bg-active, #e0e2e6);
}
.nav-label {
  font-weight: 600;
}
.nav-desc {
  font-size: 11px;
  color: var(--sui-fg-muted, #8a8f98);
}
.content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
}
</style>
