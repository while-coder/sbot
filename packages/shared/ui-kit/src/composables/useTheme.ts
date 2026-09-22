import { ref } from "vue"

// 主题模型（与 styles/theme-dark.css 的 :root[data-theme="dark"] 约定一致）：
//   light = tokens.css 中 :root 的默认值；
//   任意主题 = html[data-theme="<name>"] 覆盖 token + 声明 color-scheme。
// isDark 以 color-scheme 为判定依据（同时驱动浏览器原生控件跟随主题），
// 未声明 color-scheme 时回退到 data-theme === "dark"。
const theme = ref<string>("")
const isDark = ref<boolean>(false)

function detectTheme(): string {
  return document.documentElement.getAttribute("data-theme") ?? ""
}

function detectDark(): boolean {
  const scheme = getComputedStyle(document.documentElement)
    .getPropertyValue("color-scheme")
    .trim()
  return scheme ? scheme.includes("dark") : detectTheme() === "dark"
}

theme.value = detectTheme()
isDark.value = detectDark()

const observer = new MutationObserver(() => {
  theme.value = detectTheme()
  isDark.value = detectDark()
})
observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })

export function useTheme() {
  return { theme, isDark }
}

export { isDark }
