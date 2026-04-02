import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/chat' },
  // 聊天
  { path: '/chat', component: () => import('@/views/ChatView.vue') },
  { path: '/directory', component: () => import('@/views/DirectoryView.vue') },
  { path: '/channels', component: () => import('@/views/ChannelsView.vue') },
  // 基础
  { path: '/settings', component: () => import('@/views/SettingsView.vue') },
  // 模型
  { path: '/models', component: () => import('@/views/ModelsView.vue') },
  { path: '/embeddings', component: () => import('@/views/EmbeddingsView.vue') },
  // 智能体
  { path: '/agents', component: () => import('@/views/agents/AgentsView.vue') },
  { path: '/savers', component: () => import('@/views/SaversView.vue') },
  { path: '/memories', component: () => import('@/views/MemoriesView.vue') },
  { path: '/mcp', component: () => import('@/views/McpView.vue') },
  { path: '/skills', component: () => import('@/views/SkillsView.vue') },
  { path: '/prompts', component: () => import('@/views/PromptsView.vue') },
  // 管理
  { path: '/users', component: () => import('@/views/UsersView.vue') },
  { path: '/scheduler', component: () => import('@/views/SchedulerView.vue') },
  { path: '/logs', component: () => import('@/views/LogsView.vue') },
  { path: '/about', component: () => import('@/views/AboutView.vue') },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
