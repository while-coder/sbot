<script setup lang="ts">
import { ref, computed } from 'vue'
import { openLogin, listDevices, type XiaoaiCreds, type XiaoaiDevice } from './tauri'

type Phase = 'idle' | 'logging_in' | 'fetching_devices' | 'awaiting_devices' | 'done'

const phase = ref<Phase>('idle')
const error = ref('')
const creds = ref<XiaoaiCreds | null>(null)
const devices = ref<XiaoaiDevice[]>([])
const selectedDeviceName = ref('')
const copied = ref(false)

async function start() {
  error.value = ''
  copied.value = false
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
  selectedDeviceName.value = devices.value[0].name
  phase.value = 'awaiting_devices'
}

function confirmDevice() {
  phase.value = 'done'
}

const finalJson = computed(() => {
  if (!creds.value || !selectedDeviceName.value) return ''
  return JSON.stringify({
    userId: creds.value.userId,
    passToken: creds.value.passToken,
    deviceId: creds.value.deviceId,
    device: selectedDeviceName.value,
  }, null, 2)
})

async function copy() {
  try {
    await navigator.clipboard.writeText(finalJson.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch (e: any) {
    error.value = `复制失败: ${String(e?.message || e)}`
  }
}

function reset() {
  phase.value = 'idle'
  creds.value = null
  devices.value = []
  selectedDeviceName.value = ''
  error.value = ''
  copied.value = false
}
</script>

<template>
  <div class="xiaoai">
    <h2>小爱登录</h2>
    <p class="lead">点击下方按钮打开小米官方登录页。登录成功后会自动关闭、拉取音箱列表，最后输出可粘贴的 JSON。</p>

    <section v-if="phase === 'idle'" class="card">
      <button class="btn" @click="start">打开小米登录</button>
      <p class="hint">支持账号密码 / 短信 / 扫码 / 图形验证（按小米页面引导）</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section v-else-if="phase === 'logging_in'" class="card">
      <div class="status">登录窗口已打开，等待你完成登录…</div>
      <p class="hint">登录成功后这里会继续。如果你点了取消，可以再点一次"打开小米登录"。</p>
    </section>

    <section v-else-if="phase === 'fetching_devices'" class="card">
      <div class="status">登录成功，正在拉取音箱列表…</div>
    </section>

    <section v-else-if="phase === 'awaiting_devices'" class="card">
      <div class="status success">登录成功，请选择音箱</div>
      <ul class="device-list">
        <li v-for="d in devices" :key="d.deviceID">
          <label>
            <input type="radio" v-model="selectedDeviceName" :value="d.name" />
            <span class="device-name">{{ d.name }}</span>
            <span v-if="d.alias && d.alias !== d.name" class="device-alias">（{{ d.alias }}）</span>
          </label>
        </li>
      </ul>
      <button class="btn" @click="confirmDevice">使用该音箱</button>
    </section>

    <section v-else-if="phase === 'done'" class="card">
      <div class="status success">凭据已就绪</div>
      <pre class="json">{{ finalJson }}</pre>
      <div class="actions">
        <button class="btn" @click="copy">{{ copied ? '已复制 ✓' : '复制 JSON' }}</button>
        <button class="btn btn-outline" @click="reset">重新登录</button>
      </div>
      <p class="hint">回到 admin → 添加 / 编辑 xiaoai 频道 → 展开"粘贴凭据 JSON" → 粘贴 → 解析并填入 → 保存。</p>
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
.status.success { color: var(--success); font-weight: 500; }
.hint { font-size: 12px; color: var(--fg-muted); margin: 12px 0 0; }
.error { color: var(--danger); margin: 12px 0 0; font-size: 13px; }
.device-list { list-style: none; padding: 0; margin: 0 0 16px; }
.device-list li { padding: 8px 0; border-bottom: 1px solid var(--border); }
.device-list li:last-child { border-bottom: none; }
.device-list label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.device-name { font-weight: 500; }
.device-alias { color: var(--fg-muted); font-size: 12px; }
.json {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 12px; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  margin: 0 0 12px; white-space: pre-wrap; word-break: break-all;
}
.actions { display: flex; gap: 12px; }
</style>
