<script setup lang="ts">
import { ref } from 'vue'
import { openLogin, logout, listDevices, type XiaoaiCreds, type XiaoaiDevice } from './tauri'

type Phase = 'idle' | 'logging_in' | 'fetching_devices' | 'done' | 'logging_out'

const phase = ref<Phase>('idle')
const error = ref('')
const creds = ref<XiaoaiCreds | null>(null)
const devices = ref<XiaoaiDevice[]>([])
const copiedKey = ref('')

async function start() {
  error.value = ''
  copiedKey.value = ''
  phase.value = 'logging_in'
  try {
    creds.value = await openLogin()
  } catch (e: any) {
    phase.value = 'idle'
    error.value = String(e?.message || e)
    return
  }

  phase.value = 'fetching_devices'
  try {
    devices.value = await listDevices(creds.value)
  } catch (e: any) {
    phase.value = 'idle'
    error.value = `已拿到登录凭据，但拉设备列表失败: ${String(e?.message || e)}`
    return
  }

  if (devices.value.length === 0) {
    error.value = '该账号下未发现小爱音箱'
    phase.value = 'idle'
    return
  }
  phase.value = 'done'
}

async function copyValue(key: string, value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copiedKey.value = key
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = ''
    }, 2000)
  } catch (e: any) {
    error.value = `复制失败: ${String(e?.message || e)}`
  }
}

function reset() {
  phase.value = 'idle'
  creds.value = null
  devices.value = []
  error.value = ''
  copiedKey.value = ''
}

async function switchAccount() {
  const prev = phase.value
  phase.value = 'logging_out'
  error.value = ''
  try {
    await logout()
  } catch (e: any) {
    error.value = `登出失败: ${String(e?.message || e)}`
    phase.value = prev
    return
  }
  reset()
}
</script>

<template>
  <div class="xiaoai">
    <h2>小爱登录</h2>
    <p class="lead">点击下方按钮打开小米官方登录页。登录成功并拉取到音箱后，下面每一项都可以单独复制。</p>

    <section v-if="phase === 'idle'" class="card">
      <div class="actions">
        <button class="btn" @click="start">打开小米登录</button>
        <button class="btn btn-outline" @click="switchAccount">清除登录缓存</button>
      </div>
      <p class="hint">支持账号密码 / 短信 / 扫码 / 图形验证（按小米页面引导）。如果点击登录后自动登上的是上次的账号，先点「清除登录缓存」。</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section v-else-if="phase === 'logging_in'" class="card">
      <div class="status">登录窗口已打开，等待你完成登录…</div>
      <p class="hint">登录成功后这里会继续。如果你点了取消，可以再点一次"打开小米登录"。</p>
    </section>

    <section v-else-if="phase === 'fetching_devices'" class="card">
      <div class="status">登录成功，正在拉取音箱列表…</div>
    </section>

    <section v-else-if="phase === 'logging_out'" class="card">
      <div class="status">正在清除登录态…</div>
      <p class="hint">清除完成后即可用另一个账号登录。</p>
    </section>

    <section v-else-if="phase === 'done' && creds" class="card">
      <div class="status success">凭据已就绪</div>

      <div class="field-group">
        <h3 class="group-title">账号凭据</h3>
        <div class="field">
          <span class="field-label">userId</span>
          <code class="field-value">{{ creds.userId }}</code>
          <button class="copy-btn" @click="copyValue('userId', creds.userId)">
            {{ copiedKey === 'userId' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
        <div class="field">
          <span class="field-label">passToken</span>
          <code class="field-value">{{ creds.passToken }}</code>
          <button class="copy-btn" @click="copyValue('passToken', creds.passToken)">
            {{ copiedKey === 'passToken' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
      </div>

      <div class="field-group">
        <h3 class="group-title">音箱列表（{{ devices.length }}）</h3>
        <div v-for="(d, i) in devices" :key="d.deviceID" class="device-block">
          <div class="device-header">
            <span class="device-name">{{ d.name }}</span>
            <span v-if="d.alias && d.alias !== d.name" class="device-alias">（{{ d.alias }}）</span>
          </div>
          <div class="field">
            <span class="field-label">name</span>
            <code class="field-value">{{ d.name }}</code>
            <button class="copy-btn" @click="copyValue(`name-${i}`, d.name)">
              {{ copiedKey === `name-${i}` ? '已复制 ✓' : '复制' }}
            </button>
          </div>
          <div class="field">
            <span class="field-label">deviceID</span>
            <code class="field-value">{{ d.deviceID }}</code>
            <button class="copy-btn" @click="copyValue(`deviceID-${i}`, d.deviceID)">
              {{ copiedKey === `deviceID-${i}` ? '已复制 ✓' : '复制' }}
            </button>
          </div>
          <div class="field">
            <span class="field-label">miotDID</span>
            <code class="field-value">{{ d.miotDID }}</code>
            <button class="copy-btn" @click="copyValue(`miotDID-${i}`, d.miotDID)">
              {{ copiedKey === `miotDID-${i}` ? '已复制 ✓' : '复制' }}
            </button>
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-outline" @click="reset">返回</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </div>
</template>

<style scoped>
.xiaoai { max-width: 720px; margin: 0 auto; }
.lead { color: var(--fg-muted); margin-bottom: 20px; }
.card {
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 20px; margin-bottom: 16px;
}
.status { font-size: 14px; margin-bottom: 12px; }
.status.success { color: var(--success); font-weight: 500; margin-bottom: 16px; }
.hint { font-size: 12px; color: var(--fg-muted); margin: 12px 0 0; }
.error { color: var(--danger); margin: 12px 0 0; font-size: 13px; }

.field-group { margin-bottom: 20px; }
.field-group:last-of-type { margin-bottom: 12px; }
.group-title {
  font-size: 13px; font-weight: 600; color: var(--fg-muted);
  margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.5px;
}

.device-block {
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 12px; margin-bottom: 10px; background: var(--bg);
}
.device-block:last-child { margin-bottom: 0; }
.device-header { margin-bottom: 8px; }
.device-name { font-weight: 600; }
.device-alias { color: var(--fg-muted); font-size: 12px; margin-left: 4px; }

.field {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; border-bottom: 1px solid var(--border);
}
.field:last-child { border-bottom: none; }
.field-label {
  flex: 0 0 90px; font-size: 12px; color: var(--fg-muted);
}
.field-value {
  flex: 1 1 auto; min-width: 0;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  background: transparent; padding: 4px 6px; border-radius: 4px;
  word-break: break-all; user-select: text;
}
.copy-btn {
  flex: 0 0 auto; padding: 4px 10px; font-size: 12px;
  border: 1px solid var(--border); background: var(--card);
  border-radius: 4px; cursor: pointer;
}
.copy-btn:hover { background: var(--border); }

.actions { display: flex; gap: 12px; margin-top: 8px; }
</style>
