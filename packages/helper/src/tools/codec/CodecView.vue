<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  stringToBase64, base64ToString, base64ToBase64Url, base64UrlToBase64,
  stringToHex, hexToString,
  urlEncode, urlDecode,
  htmlEncode, htmlDecode,
  unicodeEscape, unicodeUnescape,
  jsonFormat, jsonMinify,
  uuid, dateToUnixSeconds, unixSecondsToDate, formatBytes,
  hashString, hashFile,
  fileToBase64, downloadBase64, downloadText,
  type HashAlgorithm,
} from './codec'

type Tab = 'text' | 'file' | 'hash' | 'misc'

const activeTab = ref<Tab>('text')
const error = ref('')
const copiedKey = ref('')

// ── Text 面板 ────────────────────────────────────────────
const textInput = ref('')
const textOutput = ref('')

function safeRun(fn: () => string) {
  error.value = ''
  try { textOutput.value = fn() }
  catch (e: any) { error.value = String(e?.message || e) }
}

function swapTextIO() {
  const v = textOutput.value
  textOutput.value = textInput.value
  textInput.value = v
}

// ── File 面板 ────────────────────────────────────────────
const filePicked = ref<File | null>(null)
const fileBase64 = ref('')
const fileBase64Loading = ref(false)
const decodeFilename = ref('decoded.bin')
const decodeBase64Input = ref('')

function onFilePicked(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  filePicked.value = f
  fileBase64.value = ''
}

async function doFileToBase64() {
  if (!filePicked.value) return
  error.value = ''
  fileBase64Loading.value = true
  try { fileBase64.value = await fileToBase64(filePicked.value) }
  catch (e: any) { error.value = String(e?.message || e) }
  finally { fileBase64Loading.value = false }
}

function doBase64ToFile() {
  if (!decodeBase64Input.value) return
  error.value = ''
  try {
    const b64 = decodeBase64Input.value.includes(',')
      ? decodeBase64Input.value.split(',', 2)[1]
      : decodeBase64Input.value
    downloadBase64(b64.trim(), decodeFilename.value || 'decoded.bin')
  } catch (e: any) { error.value = String(e?.message || e) }
}

// ── Hash 面板 ────────────────────────────────────────────
const hashAlgo = ref<HashAlgorithm>('md5')
const hashInput = ref('')
const hashOutput = ref('')
const hashFilePicked = ref<File | null>(null)
const hashFileResult = ref('')
const hashFileBusy = ref(false)

async function doHashString() {
  error.value = ''
  try { hashOutput.value = await hashString(hashInput.value, hashAlgo.value) }
  catch (e: any) { error.value = String(e?.message || e) }
}

function onHashFilePicked(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  hashFilePicked.value = f
  hashFileResult.value = ''
}

async function doHashFile() {
  if (!hashFilePicked.value) return
  error.value = ''
  hashFileBusy.value = true
  try { hashFileResult.value = await hashFile(hashFilePicked.value, hashAlgo.value) }
  catch (e: any) { error.value = String(e?.message || e) }
  finally { hashFileBusy.value = false }
}

// ── Misc 面板 ────────────────────────────────────────────
const generatedUuid = ref('')
const tsInput = ref('')
const tsOutputDate = ref('')
const dateInput = ref('')
const tsOutput = ref('')
const bytesInput = ref('')
const bytesOutput = ref('')

function genUuid() { generatedUuid.value = uuid() }

function tsToDate() {
  error.value = ''
  const n = Number(tsInput.value)
  if (!Number.isFinite(n)) { error.value = '请输入有效数字'; return }
  tsOutputDate.value = unixSecondsToDate(n).toLocaleString()
}

function dateToTs() {
  error.value = ''
  const v = dateInput.value
  if (!v) { tsOutput.value = String(dateToUnixSeconds()); return }
  const d = new Date(v)
  if (isNaN(d.getTime())) { error.value = '日期格式无效'; return }
  tsOutput.value = String(dateToUnixSeconds(d))
}

function nowTs() {
  tsOutput.value = String(dateToUnixSeconds())
}

function fmtBytes() {
  error.value = ''
  const n = Number(bytesInput.value)
  if (!Number.isFinite(n)) { error.value = '请输入有效数字'; return }
  bytesOutput.value = formatBytes(n)
}

// ── 复制 ────────────────────────────────────────────────
async function copyValue(key: string, value: string) {
  if (!value) return
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

const fileInfo = computed(() => {
  const f = filePicked.value
  return f ? `${f.name} · ${formatBytes(f.size)}` : ''
})
const hashFileInfo = computed(() => {
  const f = hashFilePicked.value
  return f ? `${f.name} · ${formatBytes(f.size)}` : ''
})

const tabs: { key: Tab; label: string }[] = [
  { key: 'text', label: '文本' },
  { key: 'file', label: '文件' },
  { key: 'hash', label: '哈希' },
  { key: 'misc', label: '其他' },
]
</script>

<template>
  <div class="codec">
    <h2>编解码工具</h2>
    <p class="lead">常见编解码 / 哈希 / UUID / 时间戳。所有计算在本机完成，文件不会离开本机。</p>

    <div class="tab-bar">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >{{ t.label }}</button>
    </div>

    <!-- ===== Text Tab ===== -->
    <div v-if="activeTab === 'text'" class="panel">
      <section class="card">
        <div class="io-grid">
          <div>
            <div class="label-row">
              <span class="label">输入</span>
              <button class="link-btn" @click="textInput = ''">清空</button>
            </div>
            <textarea v-model="textInput" class="textarea" rows="8" placeholder="在此粘贴或输入文本…" />
          </div>
          <div>
            <div class="label-row">
              <span class="label">输出</span>
              <span class="actions-inline">
                <button class="link-btn" @click="swapTextIO" :disabled="!textOutput">⇄ 交换</button>
                <button class="link-btn" @click="copyValue('textOutput', textOutput)" :disabled="!textOutput">
                  {{ copiedKey === 'textOutput' ? '已复制 ✓' : '复制' }}
                </button>
              </span>
            </div>
            <textarea v-model="textOutput" class="textarea" rows="8" readonly />
          </div>
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">Base64</h3>
        <div class="btn-row">
          <button class="btn" @click="safeRun(() => stringToBase64(textInput))">字符串 → Base64</button>
          <button class="btn" @click="safeRun(() => base64ToString(textInput))">Base64 → 字符串</button>
          <button class="btn btn-outline" @click="safeRun(() => base64ToBase64Url(textInput))">Base64 → URL-safe</button>
          <button class="btn btn-outline" @click="safeRun(() => base64UrlToBase64(textInput))">URL-safe → Base64</button>
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">URL</h3>
        <div class="btn-row">
          <button class="btn" @click="safeRun(() => urlEncode(textInput))">URL Encode</button>
          <button class="btn" @click="safeRun(() => urlDecode(textInput))">URL Decode</button>
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">Hex</h3>
        <div class="btn-row">
          <button class="btn" @click="safeRun(() => stringToHex(textInput))">字符串 → Hex</button>
          <button class="btn" @click="safeRun(() => hexToString(textInput))">Hex → 字符串</button>
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">HTML</h3>
        <div class="btn-row">
          <button class="btn" @click="safeRun(() => htmlEncode(textInput))">HTML Escape</button>
          <button class="btn" @click="safeRun(() => htmlDecode(textInput))">HTML Unescape</button>
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">Unicode</h3>
        <div class="btn-row">
          <button class="btn" @click="safeRun(() => unicodeEscape(textInput))">Unicode Escape</button>
          <button class="btn" @click="safeRun(() => unicodeUnescape(textInput))">Unicode Unescape</button>
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">JSON</h3>
        <div class="btn-row">
          <button class="btn" @click="safeRun(() => jsonFormat(textInput))">美化</button>
          <button class="btn" @click="safeRun(() => jsonMinify(textInput))">压缩</button>
        </div>
      </section>
    </div>

    <!-- ===== File Tab ===== -->
    <div v-if="activeTab === 'file'" class="panel">
      <section class="card">
        <h3 class="group-title">文件 → Base64</h3>
        <div class="row">
          <input type="file" @change="onFilePicked" />
          <span v-if="fileInfo" class="meta">{{ fileInfo }}</span>
          <button class="btn" :disabled="!filePicked || fileBase64Loading" @click="doFileToBase64">
            {{ fileBase64Loading ? '编码中…' : '编码' }}
          </button>
        </div>
        <textarea v-model="fileBase64" class="textarea" rows="8" readonly placeholder="编码结果将显示在此处" />
        <div v-if="fileBase64" class="row">
          <button class="link-btn" @click="copyValue('fb64', fileBase64)">
            {{ copiedKey === 'fb64' ? '已复制 ✓' : '复制' }}
          </button>
          <button class="link-btn" @click="downloadText(fileBase64, (filePicked?.name || 'file') + '.b64.txt')">
            另存为 .b64.txt
          </button>
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">Base64 → 文件</h3>
        <textarea v-model="decodeBase64Input" class="textarea" rows="6" placeholder="在此粘贴 Base64 文本（可包含 data URL 头）" />
        <div class="row" style="margin-top:8px">
          <input v-model="decodeFilename" class="input" placeholder="filename.bin" style="flex:0 0 240px" />
          <button class="btn" :disabled="!decodeBase64Input" @click="doBase64ToFile">下载文件</button>
        </div>
      </section>
    </div>

    <!-- ===== Hash Tab ===== -->
    <div v-if="activeTab === 'hash'" class="panel">
      <section class="card">
        <h3 class="group-title">算法</h3>
        <select v-model="hashAlgo" class="input" style="flex:0 0 200px">
          <option value="md5">MD5</option>
          <option value="sha1">SHA-1</option>
          <option value="sha256">SHA-256</option>
          <option value="sha512">SHA-512</option>
        </select>
      </section>

      <section class="card">
        <h3 class="group-title">字符串哈希</h3>
        <textarea v-model="hashInput" class="textarea" rows="4" placeholder="在此输入要哈希的字符串…" />
        <div class="row" style="margin-top:8px">
          <button class="btn" @click="doHashString">计算</button>
          <input v-model="hashOutput" readonly class="input mono" style="flex:1" />
          <button v-if="hashOutput" class="link-btn" @click="copyValue('hashStr', hashOutput)">
            {{ copiedKey === 'hashStr' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">文件哈希</h3>
        <div class="row">
          <input type="file" @change="onHashFilePicked" />
          <span v-if="hashFileInfo" class="meta">{{ hashFileInfo }}</span>
          <button class="btn" :disabled="!hashFilePicked || hashFileBusy" @click="doHashFile">
            {{ hashFileBusy ? '计算中…' : '计算' }}
          </button>
        </div>
        <input v-if="hashFileResult" v-model="hashFileResult" readonly class="input mono" style="margin-top:8px" />
        <div v-if="hashFileResult" class="row">
          <button class="link-btn" @click="copyValue('hashFile', hashFileResult)">
            {{ copiedKey === 'hashFile' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
      </section>
    </div>

    <!-- ===== Misc Tab ===== -->
    <div v-if="activeTab === 'misc'" class="panel">
      <section class="card">
        <h3 class="group-title">UUID</h3>
        <div class="row">
          <button class="btn" @click="genUuid">生成</button>
          <input v-model="generatedUuid" readonly class="input mono" style="flex:1" />
          <button v-if="generatedUuid" class="link-btn" @click="copyValue('uuid', generatedUuid)">
            {{ copiedKey === 'uuid' ? '已复制 ✓' : '复制' }}
          </button>
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">时间戳</h3>
        <div class="row">
          <span class="meta">秒级时间戳</span>
          <input v-model="tsInput" class="input" placeholder="1733654400" style="flex:0 0 200px" />
          <button class="btn" @click="tsToDate">→ 日期</button>
          <input v-model="tsOutputDate" readonly class="input" style="flex:1" />
        </div>
        <div class="row" style="margin-top:8px">
          <span class="meta">日期</span>
          <input v-model="dateInput" class="input" placeholder="2026-01-01 12:00:00" style="flex:0 0 200px" />
          <button class="btn" @click="dateToTs">→ 时间戳</button>
          <button class="btn btn-outline" @click="nowTs">当前时间</button>
          <input v-model="tsOutput" readonly class="input mono" style="flex:1" />
        </div>
      </section>

      <section class="card">
        <h3 class="group-title">字节大小</h3>
        <div class="row">
          <input v-model="bytesInput" class="input" placeholder="1048576" style="flex:0 0 200px" />
          <button class="btn" @click="fmtBytes">格式化</button>
          <input v-model="bytesOutput" readonly class="input" style="flex:1" />
        </div>
      </section>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.codec { max-width: 900px; margin: 0 auto; }
.lead { color: var(--fg-muted); margin-bottom: 16px; }

.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.tab {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-muted);
  font-family: inherit;
}
.tab:hover { color: var(--fg); }
.tab.active { color: var(--fg); border-bottom-color: var(--primary); }

.panel { display: flex; flex-direction: column; gap: 12px; }
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}
.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
  margin: 0 0 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.io-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
}
.actions-inline { display: inline-flex; gap: 8px; }

.btn-row { display: flex; flex-wrap: wrap; gap: 8px; }
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.row + .row { margin-top: 8px; }

.input {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font: 13px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.input:focus { outline: none; border-color: var(--primary); }
.input.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }

.textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font: 13px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  resize: vertical;
}
.textarea:focus { outline: none; border-color: var(--primary); }

.btn {
  background: var(--primary);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.btn:hover:not(:disabled) { background: var(--primary-hover); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-outline {
  background: transparent;
  color: var(--fg);
  border: 1px solid var(--border);
}
.btn-outline:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }

.link-btn {
  background: none;
  border: none;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--fg-muted);
  cursor: pointer;
}
.link-btn:hover:not(:disabled) { color: var(--primary); }
.link-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.meta {
  font-size: 12px;
  color: var(--fg-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.error { color: var(--danger); margin: 12px 0 0; font-size: 13px; }

@media (max-width: 700px) {
  .io-grid { grid-template-columns: 1fr; }
}
</style>
