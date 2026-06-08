<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { checkJava, generateKeystore, type GenerateResult } from './tauri'

type Phase = 'idle' | 'generating' | 'done'

const phase = ref<Phase>('idle')
const error = ref('')
const javaAvailable = ref<boolean | null>(null)
const javaPath = ref('')

const alias = ref('')
const storePassword = ref('')
const storePasswordConfirm = ref('')
const keyPassword = ref('')
const keyPasswordConfirm = ref('')
const neverExpires = ref(true)
const customValidityYears = ref(25)
const showAdvanced = ref(false)

const commonName = ref('')
const organizationalUnit = ref('')
const organization = ref('')
const locality = ref('')
const state = ref('')
const country = ref('CN')

const result = ref<GenerateResult | null>(null)
const copiedKey = ref('')

const NEVER_EXPIRES_DAYS = 36500 // 100 年

const validityDays = computed(() =>
  neverExpires.value
    ? NEVER_EXPIRES_DAYS
    : Math.max(1, Math.round(customValidityYears.value * 365)),
)

const storePasswordMismatch = computed(
  () =>
    storePasswordConfirm.value.length > 0 && storePassword.value !== storePasswordConfirm.value,
)
const keyPasswordMismatch = computed(
  () => keyPasswordConfirm.value.length > 0 && keyPassword.value !== keyPasswordConfirm.value,
)

const canSubmit = computed(
  () =>
    javaAvailable.value === true &&
    alias.value.trim() &&
    storePassword.value.length >= 6 &&
    storePassword.value === storePasswordConfirm.value &&
    keyPassword.value.length >= 6 &&
    keyPassword.value === keyPasswordConfirm.value &&
    commonName.value.trim() &&
    validityDays.value >= 1,
)

const secretBlock = computed(() => {
  if (!result.value) return ''
  return [
    `ANDROID_KEYSTORE_BASE64=${result.value.base64}`,
    `ANDROID_KEYSTORE_PASSWORD=${storePassword.value}`,
    `ANDROID_KEY_ALIAS=${alias.value.trim()}`,
    `ANDROID_KEY_PASSWORD=${keyPassword.value}`,
  ].join('\n')
})

onMounted(async () => {
  try {
    const r = await checkJava()
    javaAvailable.value = r.available
    javaPath.value = r.path ?? ''
  } catch (e: any) {
    javaAvailable.value = false
    error.value = String(e?.message || e)
  }
})

async function submit() {
  error.value = ''
  if (!canSubmit.value) return

  const path = await save({
    title: '选择 keystore 保存位置',
    defaultPath: 'release.jks',
    filters: [
      { name: 'Java KeyStore', extensions: ['jks', 'keystore', 'p12'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (!path) return

  phase.value = 'generating'
  try {
    result.value = await generateKeystore({
      path,
      alias: alias.value.trim(),
      storePassword: storePassword.value,
      keyPassword: keyPassword.value,
      validityDays: validityDays.value,
      dname: {
        commonName: commonName.value.trim(),
        organizationalUnit: organizationalUnit.value.trim() || undefined,
        organization: organization.value.trim() || undefined,
        locality: locality.value.trim() || undefined,
        state: state.value.trim() || undefined,
        country: country.value.trim() || undefined,
      },
    })
    phase.value = 'done'
  } catch (e: any) {
    phase.value = 'idle'
    error.value = String(e?.message || e)
  }
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
  result.value = null
  storePassword.value = ''
  storePasswordConfirm.value = ''
  keyPassword.value = ''
  keyPasswordConfirm.value = ''
  error.value = ''
  copiedKey.value = ''
}
</script>

<template>
  <div class="ks">
    <h2>Keystore 生成</h2>
    <p class="lead">
      生成 Android APK 签名用的 keystore（PKCS12 格式）。所有输入仅在本机运行 <code>keytool</code> 时使用，不会上传到任何服务器。
    </p>

    <p v-if="javaAvailable === false" class="warn">
      未检测到 <code>keytool</code>。请先安装 JDK 17+（推荐 <a href="https://adoptium.net/" target="_blank" rel="noopener">Adoptium Temurin</a>），然后重启应用。
    </p>
    <p v-else-if="javaAvailable === true" class="hint">
      检测到 keytool: <code>{{ javaPath }}</code>
    </p>

    <section v-if="phase === 'idle'" class="card">
      <div class="field-row">
        <label class="field-label">Alias</label>
        <input v-model="alias" class="input" placeholder="例如 myapp" />
      </div>

      <div class="field-row">
        <label class="field-label">keystore 密码</label>
        <input v-model="storePassword" type="password" class="input" placeholder="≥ 6 位" />
      </div>

      <div class="field-row">
        <label class="field-label">确认 keystore 密码</label>
        <input v-model="storePasswordConfirm" type="password" class="input" />
        <span v-if="storePasswordMismatch" class="inline-err">两次不一致</span>
      </div>

      <div class="field-row">
        <label class="field-label">key 密码</label>
        <input v-model="keyPassword" type="password" class="input" placeholder="≥ 6 位（PKCS12 推荐与上面相同）" />
      </div>

      <div class="field-row">
        <label class="field-label">确认 key 密码</label>
        <input v-model="keyPasswordConfirm" type="password" class="input" />
        <span v-if="keyPasswordMismatch" class="inline-err">两次不一致</span>
      </div>

      <div class="field-row">
        <label class="field-label">有效期</label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="neverExpires" />
          永不过期（{{ Math.round(NEVER_EXPIRES_DAYS / 365) }} 年）
        </label>
      </div>
      <div v-if="!neverExpires" class="field-row indent">
        <label class="field-label">自定义（年）</label>
        <input v-model.number="customValidityYears" type="number" min="1" max="100" class="input small" />
        <span class="hint inline">≈ {{ validityDays }} 天，建议 ≥ 25 年</span>
      </div>

      <div class="advanced">
        <button type="button" class="link-btn" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? '▾' : '▸' }} 高级：证书 DName（用默认值即可）
        </button>
        <div v-if="showAdvanced" class="advanced-fields">
          <div class="field-row">
            <label class="field-label">CN（必填）</label>
            <input v-model="commonName" class="input" placeholder="例如 myapp" />
          </div>
          <div class="field-row">
            <label class="field-label">OU 部门</label>
            <input v-model="organizationalUnit" class="input" />
          </div>
          <div class="field-row">
            <label class="field-label">O 组织</label>
            <input v-model="organization" class="input" />
          </div>
          <div class="field-row">
            <label class="field-label">L 城市</label>
            <input v-model="locality" class="input" />
          </div>
          <div class="field-row">
            <label class="field-label">ST 省份</label>
            <input v-model="state" class="input" />
          </div>
          <div class="field-row">
            <label class="field-label">C 国家</label>
            <input v-model="country" class="input small" maxlength="2" placeholder="CN" />
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="btn" :disabled="!canSubmit" @click="submit">选择路径并生成</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section v-else-if="phase === 'generating'" class="card">
      <div class="status">正在调用 keytool 生成 keystore…</div>
    </section>

    <section v-else-if="phase === 'done' && result" class="card">
      <div class="status success">生成成功</div>

      <div class="field-group">
        <h3 class="group-title">文件</h3>
        <div class="field">
          <span class="field-label-narrow">路径</span>
          <code class="field-value">{{ result.path }}</code>
          <button class="copy-btn" @click="copyValue('path', result.path)">
            {{ copiedKey === 'path' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
        <div class="field">
          <span class="field-label-narrow">SHA-256</span>
          <code class="field-value mono-sm">{{ result.fingerprint_sha256 }}</code>
        </div>
        <div class="field">
          <span class="field-label-narrow">SHA-1</span>
          <code class="field-value mono-sm">{{ result.fingerprint_sha1 }}</code>
        </div>
      </div>

      <div class="field-group">
        <h3 class="group-title">GitHub Secrets（一键贴入仓库 Settings → Secrets and variables → Actions）</h3>
        <div class="field">
          <span class="field-label-narrow">ANDROID_KEYSTORE_BASE64</span>
          <code class="field-value truncate">{{ result.base64 }}</code>
          <button class="copy-btn" @click="copyValue('base64', result.base64)">
            {{ copiedKey === 'base64' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
        <div class="field">
          <span class="field-label-narrow">ANDROID_KEYSTORE_PASSWORD</span>
          <code class="field-value">••••••</code>
          <button class="copy-btn" @click="copyValue('storepass', storePassword)">
            {{ copiedKey === 'storepass' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
        <div class="field">
          <span class="field-label-narrow">ANDROID_KEY_ALIAS</span>
          <code class="field-value">{{ alias }}</code>
          <button class="copy-btn" @click="copyValue('alias', alias)">
            {{ copiedKey === 'alias' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
        <div class="field">
          <span class="field-label-narrow">ANDROID_KEY_PASSWORD</span>
          <code class="field-value">••••••</code>
          <button class="copy-btn" @click="copyValue('keypass', keyPassword)">
            {{ copiedKey === 'keypass' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
        <div class="actions inline">
          <button class="btn btn-outline" @click="copyValue('all', secretBlock)">
            {{ copiedKey === 'all' ? '已复制全部 ✓' : '复制 4 个 KEY=VALUE' }}
          </button>
        </div>
      </div>

      <p class="warn">
        ⚠️ 关键文件提醒：
        <strong>{{ result.path.split(/[\\/]/).pop() }}</strong>
        是 app 终身签名身份。务必<strong>立刻备份</strong>到密码管理器或私有云盘——丢失后老用户将无法升级。也不要提交到 git。
      </p>

      <div class="actions">
        <button class="btn btn-outline" @click="reset">再生成一个</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </div>
</template>

<style scoped>
.ks { max-width: 720px; margin: 0 auto; }
.lead { color: var(--fg-muted); margin-bottom: 16px; }
.warn {
  background: var(--card); border: 1px solid var(--warning, #d97706);
  border-radius: var(--radius); padding: 10px 12px; font-size: 13px;
  color: var(--warning, #d97706); margin: 12px 0;
}
.hint { font-size: 12px; color: var(--fg-muted); margin: 8px 0 16px; }
.hint.inline { margin: 0; }
.error { color: var(--danger); margin: 12px 0 0; font-size: 13px; }
.inline-err { color: var(--danger); font-size: 12px; margin-left: 4px; }

.card {
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 20px; margin-bottom: 16px;
}
.status { font-size: 14px; margin-bottom: 12px; }
.status.success { color: var(--success); font-weight: 500; margin-bottom: 16px; }

.field-row {
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
}
.field-label {
  flex: 0 0 130px; font-size: 13px; color: var(--fg-muted);
}
.input {
  flex: 1 1 auto; padding: 6px 10px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg); color: var(--fg);
  font: 13px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.input.small { flex: 0 0 100px; }
.input:focus { outline: none; border-color: var(--primary); }

.checkbox-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; cursor: pointer; user-select: none;
}
.checkbox-label input { margin: 0; cursor: pointer; }
.field-row.indent { padding-left: 130px; }
.field-row.indent .field-label { flex: 0 0 100px; }

.advanced { margin: 8px 0 12px; }
.advanced-fields {
  border-left: 2px solid var(--border); padding-left: 12px; margin-top: 8px;
}
.link-btn {
  background: none; border: none; padding: 4px 0; font-size: 13px;
  color: var(--fg-muted); cursor: pointer;
}
.link-btn:hover { color: var(--fg); }

.field-group { margin-bottom: 20px; }
.group-title {
  font-size: 13px; font-weight: 600; color: var(--fg-muted);
  margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.5px;
}
.field {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; border-bottom: 1px solid var(--border);
}
.field:last-child { border-bottom: none; }
.field-label-narrow {
  flex: 0 0 200px; font-size: 12px; color: var(--fg-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.field-value {
  flex: 1 1 auto; min-width: 0;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  background: transparent; padding: 4px 6px; border-radius: 4px;
  word-break: break-all; user-select: text;
}
.field-value.mono-sm { font-size: 11px; }
.field-value.truncate {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.copy-btn {
  flex: 0 0 auto; padding: 4px 10px; font-size: 12px;
  border: 1px solid var(--border); background: var(--card);
  border-radius: 4px; cursor: pointer;
}
.copy-btn:hover { background: var(--border); }

.actions { display: flex; gap: 12px; margin-top: 12px; }
.actions.inline { margin-top: 8px; }
</style>
