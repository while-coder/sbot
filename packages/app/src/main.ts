function showStartupError(error: unknown) {
  const root = document.getElementById('app')
  if (!root) return
  const err = error instanceof Error ? error : null
  const message = err?.stack || err?.message || String(error)
  const escaped = message.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[char] ?? char
  })
  root.innerHTML = `
    <div style="padding:16px;font:14px/1.5 sans-serif;color:#b42318;background:#fff;">
      <strong>应用启动失败</strong>
      <pre style="white-space:pre-wrap;margin-top:8px;font-size:12px;">${escaped}</pre>
    </div>
  `
}

window.addEventListener('error', (event) => showStartupError(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => showStartupError(event.reason))

;(async () => {
  try {
    const { createApp } = await import('vue')
    const { default: App } = await import('./App.vue')
    createApp(App).mount('#app')
  } catch (error) {
    showStartupError(error)
  }
})()
