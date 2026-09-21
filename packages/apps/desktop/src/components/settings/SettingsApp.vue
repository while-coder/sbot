<script setup lang="ts">
import { computed, ref } from 'vue'
import GeneralPage from './pages/GeneralPage.vue'
import ModelsPage from './pages/ModelsPage.vue'
import ChannelsPage from './pages/ChannelsPage.vue'
import AboutPage from './pages/AboutPage.vue'

type PageKey = 'general' | 'models' | 'channels' | 'about'

const props = defineProps<{ initialPage?: PageKey }>()

const NAV: Array<{ key: PageKey; label: string; desc: string }> = [
  { key: 'general', label: '常规', desc: '外观与基础行为' },
  { key: 'models', label: '模型', desc: 'LLM 模型接入' },
  { key: 'channels', label: '渠道', desc: '消息渠道接入' },
  { key: 'about', label: '关于', desc: '版本与诊断' },
]

const active = ref<PageKey>(props.initialPage ?? 'general')
const activeInfo = computed(() => NAV.find(n => n.key === active.value) ?? NAV[0])
</script>

<template>
  <div class="settings-app">
    <aside class="nav">
      <button
        v-for="item in NAV"
        :key="item.key"
        class="nav-item"
        :class="{ active: active === item.key }"
        type="button"
        @click="active = item.key"
      >
        {{ item.label }}
      </button>
    </aside>

    <main class="content">
      <header class="content-head">
        <h3>{{ activeInfo.label }}</h3>
        <p>{{ activeInfo.desc }}</p>
      </header>
      <div class="pages">
        <GeneralPage v-show="active === 'general'" />
        <ModelsPage v-show="active === 'models'" />
        <ChannelsPage v-show="active === 'channels'" />
        <AboutPage v-show="active === 'about'" />
      </div>
    </main>
  </div>
</template>

<style scoped>
.settings-app {
  height: 100%;
  display: flex;
  overflow: hidden;
  color: var(--sui-fg, #1f2328);
}
.nav {
  width: 160px;
  flex-shrink: 0;
  padding: 12px 10px;
  border-right: 1px solid var(--sui-border, #e5e7eb);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.nav-item {
  padding: 7px 12px;
  border: none;
  border-radius: 6px;
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
  font-weight: 600;
}
.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.content-head {
  flex-shrink: 0;
  padding: 18px 24px 10px;
}
.content-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--sui-fg, #1f2328);
}
.content-head p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--sui-fg-muted, #8a8f98);
}
.pages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
