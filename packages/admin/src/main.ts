import { createApp } from 'vue'
import router from './router'
import App from './App.vue'
import { i18n } from './i18n'
import SbotUI from 'sbot-ui'
import 'sbot-ui/tokens/index.css'

const app = createApp(App)
app.use(router)
app.use(i18n)
app.use(SbotUI)
app.mount('#app')
