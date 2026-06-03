import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'sbot',
  description: 'Self-hosted AI Agent Server',
  outDir: '../../docs',
  base: '/sbot/',
  head: [
    ['link', { rel: 'icon', href: '/sbot/logo.svg' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'GitHub', link: 'https://github.com/while-coder/sbot' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Features', link: '/guide/features' },
        ],
      },
      {
        text: 'Models & Agents',
        items: [
          { text: 'Models', link: '/guide/models' },
          { text: 'Agents', link: '/guide/agents' },
          { text: 'Agent Store', link: '/guide/agent-store' },
        ],
      },
      {
        text: 'Storage & Knowledge',
        items: [
          { text: 'Savers', link: '/guide/savers' },
          { text: 'Notes (Memory)', link: '/guide/note' },
          { text: 'Wiki', link: '/guide/wiki' },
          { text: 'Insight', link: '/guide/insight' },
        ],
      },
      {
        text: 'Tools & Skills',
        items: [
          { text: 'Built-in Tools', link: '/guide/tools' },
          { text: 'MCP Tools', link: '/guide/mcp' },
          { text: 'Skills', link: '/guide/skills' },
        ],
      },
      {
        text: 'Channels & Runtime',
        items: [
          { text: 'Channels', link: '/guide/channels' },
          { text: 'Heartbeat', link: '/guide/heartbeat' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/while-coder/sbot' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © sbot contributors',
    },
    search: {
      provider: 'local',
    },
  },
})
