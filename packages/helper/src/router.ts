import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import XiaoaiLoginView from './tools/xiaoai-login/XiaoaiLoginView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/xiaoai-login', name: 'xiaoai-login', component: XiaoaiLoginView },
  ],
})
