<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import DirectoryModal from './DirectoryModal.vue'
// DirectoryConfig 是空接口（全局注册用），目录本地文件的实际结构用此类型
type LocalDirCfg = { agent?: string; saver?: string; memory?: string }

const { show } = useToast()

const directoryModal = ref<InstanceType<typeof DirectoryModal>>()

// ── 无效路径（目录在宿主机上不存在）──
const invalidDirs = ref<string[]>([])

async function checkInvalidDirs() {
  const dirs = Object.keys(store.settings.directories || {})
  const results = await Promise.all(
    dirs.map(async (d) => {
      try {
        const res = await apiFetch(`/api/directories?dir=${encodeURIComponent(d)}`)
        return { path: d, exists: res.data?.exists === true }
      } catch {
        return { path: d, exists: false }
      }
    })
  )
  invalidDirs.value = results.filter(r => !r.exists).map(r => r.path)
}

async function removeInvalidDir(dirPath: string) {
  try {
    await apiFetch(`/api/directories?path=${encodeURIComponent(dirPath)}`, 'DELETE')
    if (store.settings.directories) delete store.settings.directories[dirPath]
    invalidDirs.value = invalidDirs.value.filter(d => d !== dirPath)
    if (activeDir.value === dirPath) { activeDir.value = null; activeCfg.value = null }
  } catch (e: any) {
    show(e.message, 'error')
  }
}

onMounted(() => checkInvalidDirs())

// ── 当前选中目录 ──
const activeDir = ref<string | null>(null)
const activeCfg = ref<LocalDirCfg | null>(null)
const loadingCfg = ref(false)

const directories = computed(() => store.settings.directories || {})

// 从路径中取最后一段作为显示名称
function dirDisplayName(p: string): string {
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || p
}

async function selectDir(dirPath: string) {
  if (activeDir.value === dirPath) return
  activeDir.value = dirPath
  activeCfg.value = null
  loadingCfg.value = true
  try {
    const res = await apiFetch(`/api/directories?dir=${encodeURIComponent(dirPath)}`)
    activeCfg.value = (res.data?.config as LocalDirCfg | null) ?? {}
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loadingCfg.value = false
  }
}

async function deleteDir(dirPath: string) {
  if (!confirm(`确定要移除目录 "${dirDisplayName(dirPath)}"？\n（只移除注册信息，不删除本地文件）`)) return
  try {
    await apiFetch(`/api/directories?path=${encodeURIComponent(dirPath)}`, 'DELETE')
    if (store.settings.directories) delete store.settings.directories[dirPath]
    if (activeDir.value === dirPath) { activeDir.value = null; activeCfg.value = null }
    show('已移除')
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function onSaved(dirPath: string, cfg: LocalDirCfg) {
  activeCfg.value = cfg
  activeDir.value = dirPath
}

function agentLabel(id?: string) {
  if (!id) return '—'
  const a = (store.settings.agents || {})[id] as any
  return a?.name || id
}
function saverLabel(id?: string) {
  if (!id) return '—'
  const s = (store.settings.savers || {})[id] as any
  return s?.name || id
}
function memoryLabel(id?: string) {
  if (!id) return '（不使用）'
  const m = (store.settings.memories || {})[id] as any
  return m?.name || id
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">

    <!-- 顶部提示框 -->
    <div class="dir-banner">
      <span class="dir-banner-label">目录管理</span>
      <span class="dir-banner-hint">
        每个目录的配置（Agent / 存储 / 记忆）保存在该目录的 <code>.sbot/settings.json</code> 中
      </span>
      <button class="btn-primary btn-sm" @click="directoryModal?.open()">+ 新增目录</button>
    </div>

    <!-- 无效路径错误条 -->
    <div v-if="invalidDirs.length > 0" class="dir-invalid-bar">
      <span class="dir-invalid-icon">!</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;margin-bottom:4px">以下目录在宿主机上不存在，请删除无效记录：</div>
        <div v-for="d in invalidDirs" :key="d" class="dir-invalid-row">
          <span class="dir-invalid-path" :title="d">{{ d }}</span>
          <button class="btn-danger btn-sm" @click="removeInvalidDir(d)">删除</button>
        </div>
      </div>
    </div>

    <!-- 主体 -->
    <div style="flex:1;display:flex;overflow:hidden;min-height:0">

      <!-- 左侧边栏 -->
      <div style="width:200px;border-right:1px solid #e8e6e3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
        <div style="padding:6px 8px;border-bottom:1px solid #e8e6e3;flex-shrink:0">
          <button class="btn-outline btn-sm" style="width:100%" @click="directoryModal?.open()">+ 新增</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:4px">
          <div v-if="Object.keys(directories).length === 0"
               style="text-align:center;color:#94a3b8;padding:20px 8px;font-size:12px">
            暂无目录<br>点击上方新增
          </div>
          <div
            v-for="(_, dirPath) in directories"
            :key="dirPath"
            class="dir-item"
            :class="{ active: activeDir === dirPath }"
            @click="selectDir(dirPath as string)"
          >
            <div style="display:flex;align-items:center;gap:4px">
              <div style="flex:1;min-width:0">
                <div class="dir-item-name" :title="dirPath as string">
                  {{ dirDisplayName(dirPath as string) }}
                </div>
                <div class="dir-item-path" :title="dirPath as string">{{ dirPath }}</div>
              </div>
              <button
                class="dir-del-btn"
                @click.stop="deleteDir(dirPath as string)"
                title="移除目录"
              >×</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧面板 -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        <div class="page-toolbar">
          <span class="page-toolbar-title">
            {{ activeDir ? dirDisplayName(activeDir) : '目录详情' }}
          </span>
          <template v-if="activeDir">
            <span style="font-size:12px;color:#9b9b9b;margin-left:4px;font-family:monospace">
              {{ activeDir }}
            </span>
            <button
              class="btn-outline btn-sm"
              style="margin-left:auto"
              @click="directoryModal?.open(activeDir!, activeCfg ?? undefined)"
            >编辑</button>
          </template>
        </div>

        <div class="page-content">
          <!-- 未选目录 -->
          <div v-if="!activeDir"
               style="text-align:center;color:#94a3b8;padding:60px;font-size:13px">
            请从左侧选择目录，或点击「新增目录」
          </div>

          <!-- 加载中 -->
          <div v-else-if="loadingCfg"
               style="text-align:center;color:#94a3b8;padding:60px;font-size:13px">
            读取配置中…
          </div>

          <!-- 已选目录 -->
          <template v-else>
            <div class="card">
              <div class="card-title">本地配置文件</div>
              <div style="font-size:13px;color:#6b6b6b;font-family:monospace">
                {{ activeDir }}/.sbot/settings.json
              </div>
              <div style="margin-top:8px;font-size:13px">
                <span v-if="activeCfg?.agent || activeCfg?.saver" style="color:#16a34a">已找到配置</span>
                <span v-else style="color:#ef4444">未找到配置或配置为空</span>
              </div>
            </div>

            <div class="card">
              <div class="card-title">DirectoryConfig</div>
              <table>
                <tbody>
                  <tr>
                    <td style="width:80px;color:#9b9b9b;font-size:12px">Agent</td>
                    <td>
                      <span v-if="activeCfg?.agent" style="font-size:13px">
                        {{ agentLabel(activeCfg.agent) }}
                        <span style="color:#9b9b9b;font-size:11px;margin-left:6px;font-family:monospace">{{ activeCfg.agent }}</span>
                      </span>
                      <span v-else style="color:#9b9b9b;font-size:13px">—</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="color:#9b9b9b;font-size:12px">存储</td>
                    <td>
                      <span v-if="activeCfg?.saver" style="font-size:13px">
                        {{ saverLabel(activeCfg.saver) }}
                        <span style="color:#9b9b9b;font-size:11px;margin-left:6px;font-family:monospace">{{ activeCfg.saver }}</span>
                      </span>
                      <span v-else style="color:#9b9b9b;font-size:13px">—</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="color:#9b9b9b;font-size:12px">记忆</td>
                    <td style="font-size:13px">{{ memoryLabel(activeCfg?.memory) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </div>

    <DirectoryModal ref="directoryModal" @saved="onSaved" />
  </div>
</template>

<style scoped>
.dir-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: #f8f7f5;
  border-bottom: 2px solid #e8e6e3;
  flex-shrink: 0;
  font-size: 13px;
}
.dir-banner-label {
  font-size: 12px;
  font-weight: 700;
  color: #6b6b6b;
  white-space: nowrap;
}
.dir-banner-hint {
  flex: 1;
  font-size: 12px;
  color: #9b9b9b;
}
.dir-invalid-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  background: #fef2f2;
  border-bottom: 1px solid #fca5a5;
  flex-shrink: 0;
  font-size: 13px;
}
.dir-invalid-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  background: #ef4444;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  margin-top: 1px;
}
.dir-invalid-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.dir-invalid-path {
  font-family: monospace;
  font-size: 12px;
  color: #b91c1c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 600px;
}
.dir-banner-hint code {
  background: #eceae6;
  border-radius: 3px;
  padding: 1px 4px;
  font-family: monospace;
  font-size: 11px;
  color: #3d3d3d;
}
.dir-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background .12s;
  margin-bottom: 2px;
}
.dir-item:hover { background: #f5f4f2; }
.dir-item.active { background: #f0efed; }
.dir-item-name {
  font-size: 13px;
  font-weight: 500;
  color: #1c1c1c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir-item-path {
  font-size: 10px;
  color: #9b9b9b;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}
.dir-del-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: transparent;
  font-size: 16px;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
  transition: color .1s;
}
.dir-item:hover .dir-del-btn { color: #94a3b8; }
.dir-del-btn:hover { color: #ef4444 !important; }
</style>
