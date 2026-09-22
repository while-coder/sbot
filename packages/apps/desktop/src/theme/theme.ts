import { computed, ref, watch } from 'vue'
import lightThemeCSS from '@sbot/chat-ui/themes/theme-light.css?inline'
import darkThemeCSS from '@sbot/chat-ui/themes/theme-dark.css?inline'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/sbot-ui-bridge.css'
import '@sbot/ui-kit/style.css'

/**
 * 三态主题单例（system/light/dark）：
 * - chat-ui 的 theme css 单份注入（client 已验证方案），同一时刻只有一份 :root 生效
 * - documentElement.dataset.theme 驱动 @sbot/ui-kit tokens（html[data-theme="dark"]）与原生控件
 * - mode 存 localStorage（同 origin 两窗口共享，storage 事件跨窗口同步）
 */
export type ThemeMode = 'system' | 'light' | 'dark'

const THEME_KEY = 'sbot:theme'

function readMode(): ThemeMode {
  try {
    const v = window.localStorage?.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export const themeMode = ref<ThemeMode>(readMode())

const mq = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

const resolvedTheme = computed<'light' | 'dark'>(() =>
  themeMode.value === 'system' ? (mq?.matches ? 'dark' : 'light') : themeMode.value,
)

const themeStyleEl = document.createElement('style')
themeStyleEl.id = 'chatui-theme'
document.head.appendChild(themeStyleEl)

function applyTheme(t: 'light' | 'dark') {
  themeStyleEl.textContent = t === 'dark' ? darkThemeCSS : lightThemeCSS
  document.documentElement.dataset.theme = t
}

export const resolvedThemeRef = resolvedTheme

function onSystemChange() {
  if (themeMode.value === 'system') applyTheme(resolvedTheme.value)
}

let initialized = false

export function initTheme(): void {
  if (initialized) return
  initialized = true

  watch(resolvedTheme, applyTheme, { immediate: true })
  watch(themeMode, (m) => {
    try { window.localStorage?.setItem(THEME_KEY, m) } catch {}
  })

  if (mq) {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onSystemChange)
    else mq.addListener?.(onSystemChange)
  }

  // 同 origin 跨窗口同步：设置窗口改主题 → storage 事件 → 主窗口跟随
  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_KEY || e.newValue == null) return
    if (e.newValue === 'light' || e.newValue === 'dark' || e.newValue === 'system') {
      themeMode.value = e.newValue
    }
  })
}

/** light/dark 间直接切换（菜单「切换主题」入口）；system 态按当前解析值取反 */
export function toggleTheme(): void {
  themeMode.value = resolvedTheme.value === 'dark' ? 'light' : 'dark'
}
