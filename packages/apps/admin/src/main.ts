import { createApp } from 'vue'
import router from './router'
import App from './App.vue'
import { i18n } from './i18n'
import { createUiKit } from '@qingfeng346/ui-kit'
import '@qingfeng346/ui-kit/style.css'

const app = createApp(App)
app.use(router)
app.use(i18n)
app.use(createUiKit())
app.mount('#app')
