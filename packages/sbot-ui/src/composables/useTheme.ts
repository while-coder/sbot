import { ref } from 'vue'

const isDark = ref<boolean>(false)

function detectDark(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

isDark.value = detectDark()

const observer = new MutationObserver(() => {
  const next = detectDark()
  if (next !== isDark.value) isDark.value = next
})
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

export function useTheme() {
  return { isDark }
}

export { isDark }
