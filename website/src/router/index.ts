import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/chat' },
  { path: '/settings', component: () => import('@/views/SettingsView.vue') },
  { path: '/chat', component: () => import('@/views/ChatView.vue') },
  { path: '/agents', component: () => import('@/views/AgentsView.vue') },
  { path: '/agents/:agentName/skills', component: () => import('@/views/AgentSkillsView.vue') },
  { path: '/models', component: () => import('@/views/ModelsView.vue') },
  { path: '/embeddings', component: () => import('@/views/EmbeddingsView.vue') },
  { path: '/savers', component: () => import('@/views/SaversView.vue') },
  { path: '/savers/:saverName/view', component: () => import('@/views/SaverViewPage.vue') },
  { path: '/memories', component: () => import('@/views/MemoriesView.vue') },
  { path: '/memories/:memName/view', component: () => import('@/views/MemoryViewPage.vue') },
  { path: '/mcp', component: () => import('@/views/McpView.vue') },
  { path: '/mcp/agent/:agentName', component: () => import('@/views/McpView.vue') },
  { path: '/skills', component: () => import('@/views/SkillsView.vue') },
  { path: '/users', component: () => import('@/views/UsersView.vue') },
  { path: '/timers', component: () => import('@/views/TimerView.vue') },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
