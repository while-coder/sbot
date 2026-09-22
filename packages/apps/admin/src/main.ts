import { createApp } from 'vue'
import router from './router'
import App from './App.vue'
import { i18n } from './i18n'
import { createUiKit } from '@sbot/ui-kit'
import '@sbot/ui-kit/style.css'

const app = createApp(App)
app.use(router)
app.use(i18n)
app.use(createUiKit())
app.mount('#app')
