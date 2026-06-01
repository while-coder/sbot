import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/chat' },
  // 聊天
  { path: '/chat', component: () => import('@/views/chat/ChatView.vue') },
  { path: '/channels', component: () => import('@/views/chat/ChannelsView.vue') },
  { path: '/session-profiles', component: () => import('@/views/chat/SessionProfilesView.vue') },
  // 基础
  { path: '/settings', component: () => import('@/views/SettingsView.vue') },
  // 模型
  { path: '/models', component: () => import('@/views/models/ModelsView.vue') },
  { path: '/embeddings', component: () => import('@/views/models/EmbeddingsView.vue') },
  // 智能体
  { path: '/agents', component: () => import('@/views/agents/AgentsView.vue') },
  { path: '/agent-store', component: () => import('@/views/agents/AgentStoreView.vue') },
  { path: '/savers', component: () => import('@/views/savers/SaversView.vue') },
  { path: '/memories', component: () => import('@/views/memory/MemoriesView.vue') },
  { path: '/wikis', component: () => import('@/views/memory/WikisView.vue') },
  { path: '/mcp', component: () => import('@/views/runtime/McpView.vue') },
  { path: '/skills', component: () => import('@/views/runtime/SkillsView.vue') },
  { path: '/prompts', component: () => import('@/views/runtime/PromptsView.vue') },
  // 管理
  { path: '/processes', component: () => import('@/views/admin/ProcessesView.vue') },
  { path: '/heartbeats', component: () => import('@/views/admin/HeartbeatView.vue') },
  { path: '/scheduler', component: () => import('@/views/admin/SchedulerView.vue') },
  { path: '/todo', component: () => import('@/views/admin/TodoView.vue') },
  { path: '/explorer', component: () => import('@/views/admin/ExplorerView.vue') },
  { path: '/logs', component: () => import('@/views/admin/LogsView.vue') },
  { path: '/token-usage', component: () => import('@/views/admin/TokenUsageView.vue') },
  { path: '/about', component: () => import('@/views/admin/AboutView.vue') },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
