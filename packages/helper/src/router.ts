import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import XiaoaiLoginView from './tools/xiaoai-login/XiaoaiLoginView.vue'
import KeystoreGenView from './tools/keystore-gen/KeystoreGenView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/xiaoai-login', name: 'xiaoai-login', component: XiaoaiLoginView },
    { path: '/keystore-gen', name: 'keystore-gen', component: KeystoreGenView },
  ],
})
