import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'sbot',
  description: 'Self-hosted AI Agent Server',
  outDir: '../../docs',
  base: '/',
  head: [
    ['link', { rel: 'icon', href: '/logo.svg' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'GitHub', link: 'https://github.com/while-coder/sbot' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Features', link: '/guide/features' },
          { text: 'Models', link: '/guide/models' },
          { text: 'Agents', link: '/guide/agents' },
          { text: 'Channels', link: '/guide/channels' },
          { text: 'Tools', link: '/guide/tools' },
          { text: 'MCP', link: '/guide/mcp' },
          { text: 'Skills', link: '/guide/skills' },
          { text: 'Memory', link: '/guide/memory' },
          { text: 'Wiki', link: '/guide/wiki' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/while-coder/sbot' },
    ],
  },
})
