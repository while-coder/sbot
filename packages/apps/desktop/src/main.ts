import { createApp } from 'vue'
import App from './App.vue'
import './styles/app.css'
import { initTheme } from './theme/theme'
import { initBackendStore } from './lib/backend'
import { initMenuBridge } from './lib/menuBridge'

window.addEventListener('error', (e) => {
  console.error('[desktop] uncaught error:', e.error ?? e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[desktop] unhandled rejection:', e.reason)
})

initTheme()
initMenuBridge()

createApp(App).mount('#app')
void initBackendStore()
