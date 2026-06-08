<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

const phase = ref<Phase>('idle')
const update = shallowRef<Update | null>(null)
const error = ref('')
const downloaded = ref(0)
const total = ref(0)

const percent = computed(() =>
  total.value > 0 ? Math.min(100, Math.round((downloaded.value / total.value) * 100)) : 0,
)

onMounted(async () => {
  try {
    const u = await check()
    if (u) {
      update.value = u
      phase.value = 'available'
    }
  } catch (e) {
    console.warn('[updater] check failed:', e)
  }
})

async function install() {
  if (!update.value) return
  phase.value = 'downloading'
  error.value = ''
  downloaded.value = 0
  total.value = 0
  try {
    await update.value.downloadAndInstall((event) => {
      if (event.event === 'Started') total.value = event.data.contentLength ?? 0
      else if (event.event === 'Progress') downloaded.value += event.data.chunkLength
    })
    phase.value = 'ready'
  } catch (e) {
    error.value = String(e)
    phase.value = 'error'
  }
}

async function restart() {
  await relaunch()
}

function dismiss() {
  phase.value = 'idle'
}
</script>

<template>
  <div v-if="phase !== 'idle'" class="updater-mask">
    <div class="updater-card">
      <template v-if="phase === 'available' && update">
        <h3>发现新版本 {{ update.version }}</h3>
        <p v-if="update.body" class="notes">{{ update.body }}</p>
        <div class="row">
          <button class="btn-secondary" @click="dismiss">稍后</button>
          <button class="btn-primary" @click="install">现在更新</button>
        </div>
      </template>
      <template v-else-if="phase === 'downloading'">
        <h3>正在下载更新…</h3>
        <div class="bar"><div class="bar-fill" :style="{ width: percent + '%' }" /></div>
        <p class="muted">
          {{ percent }}%
          <span v-if="total > 0">({{ Math.round(downloaded / 1024) }} / {{ Math.round(total / 1024) }} KB)</span>
        </p>
      </template>
      <template v-else-if="phase === 'ready'">
        <h3>更新已就绪</h3>
        <p>需要重启应用以完成更新。</p>
        <div class="row">
          <button class="btn-secondary" @click="dismiss">稍后重启</button>
          <button class="btn-primary" @click="restart">立即重启</button>
        </div>
      </template>
      <template v-else-if="phase === 'error'">
        <h3>更新失败</h3>
        <p class="error">{{ error }}</p>
        <div class="row">
          <button class="btn-secondary" @click="dismiss">关闭</button>
          <button class="btn-primary" @click="install">重试</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.updater-mask {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  font-size: 14px;
}
.updater-card {
  min-width: 320px; max-width: 480px;
  background: var(--card, #fff);
  color: var(--fg, #1a1a1a);
  border: 1px solid var(--border, transparent);
  border-radius: var(--radius, 8px);
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.updater-card h3 { margin: 0 0 12px; font-size: 16px; }
.notes {
  white-space: pre-wrap;
  max-height: 200px; overflow: auto;
  background: rgba(127, 127, 127, 0.1);
  padding: 8px 12px; border-radius: 4px;
  font-size: 13px;
  margin: 0;
}
.row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.btn-primary, .btn-secondary {
  padding: 6px 14px; border-radius: 4px;
  cursor: pointer; font-size: 13px;
  border: 1px solid transparent;
}
.btn-primary { background: var(--primary, #2d6cdf); color: #fff; }
.btn-primary:hover { background: var(--primary-hover, #1f56b8); }
.btn-secondary {
  background: transparent;
  color: inherit;
  border: 1px solid var(--border, rgba(127, 127, 127, 0.3));
}
.btn-secondary:hover { background: rgba(127, 127, 127, 0.1); }
.bar {
  height: 8px;
  background: rgba(127, 127, 127, 0.2);
  border-radius: 4px;
  overflow: hidden;
  margin: 12px 0;
}
.bar-fill { height: 100%; background: var(--primary, #2d6cdf); transition: width 0.2s; }
.muted { color: var(--fg-muted, #888); font-size: 12px; margin: 0; }
.error { color: var(--danger, #d14343); font-size: 13px; word-break: break-all; }
</style>
