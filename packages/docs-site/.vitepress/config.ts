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
    socialLinks: [
      { icon: 'github', link: 'https://github.com/while-coder/sbot' },
    ],
    search: {
      provider: 'local',
      options: {
        locales: {
          zh: {
            translations: {
              button: {
                buttonText: '搜索文档',
                buttonAriaLabel: '搜索文档',
              },
              modal: {
                noResultsText: '无法找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: {
                  selectText: '选择',
                  navigateText: '切换',
                  closeText: '关闭',
                },
              },
            },
          },
        },
      },
    },
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      title: 'sbot',
      description: 'Self-hosted AI Agent Server',
      themeConfig: {
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
              { text: 'Notes', link: '/guide/note' },
              { text: 'Wiki', link: '/guide/wiki' },
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
            text: 'Automation',
            items: [
              { text: 'Memory', link: '/guide/memory' },
              { text: 'Agenda', link: '/guide/agenda' },
              { text: 'Heartbeat', link: '/guide/heartbeat' },
            ],
          },
          {
            text: 'Channels',
            items: [
              { text: 'Channels', link: '/guide/channels' },
            ],
          },
        ],
        footer: {
          message: 'Released under the MIT License.',
          copyright: 'Copyright © sbot contributors',
        },
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      title: 'sbot',
      description: '自托管 AI Agent 服务',
      themeConfig: {
        nav: [
          { text: '指南', link: '/zh/guide/getting-started' },
          { text: 'GitHub', link: 'https://github.com/while-coder/sbot' },
        ],
        sidebar: [
          {
            text: '介绍',
            items: [
              { text: '快速开始', link: '/zh/guide/getting-started' },
              { text: '核心特性', link: '/zh/guide/features' },
            ],
          },
          {
            text: '模型与 Agent',
            items: [
              { text: '模型', link: '/zh/guide/models' },
              { text: 'Agent', link: '/zh/guide/agents' },
              { text: 'Agent 商店', link: '/zh/guide/agent-store' },
            ],
          },
          {
            text: '存储与知识',
            items: [
              { text: '存储 (Savers)', link: '/zh/guide/savers' },
              { text: '笔记 (Notes)', link: '/zh/guide/note' },
              { text: '知识库 (Wiki)', link: '/zh/guide/wiki' },
            ],
          },
          {
            text: '工具与技能',
            items: [
              { text: '内置工具', link: '/zh/guide/tools' },
              { text: 'MCP 工具', link: '/zh/guide/mcp' },
              { text: '技能', link: '/zh/guide/skills' },
            ],
          },
          {
            text: '自动化',
            items: [
              { text: '记忆 (Memory)', link: '/zh/guide/memory' },
              { text: '日程 (Agenda)', link: '/zh/guide/agenda' },
              { text: '心跳唤醒', link: '/zh/guide/heartbeat' },
            ],
          },
          {
            text: '渠道',
            items: [
              { text: '渠道', link: '/zh/guide/channels' },
            ],
          },
        ],
        docFooter: {
          prev: '上一页',
          next: '下一页',
        },
        outline: {
          label: '本页目录',
        },
        lastUpdated: {
          text: '最后更新于',
        },
        darkModeSwitchLabel: '主题',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',
        sidebarMenuLabel: '菜单',
        returnToTopLabel: '回到顶部',
        langMenuLabel: '切换语言',
        footer: {
          message: '基于 MIT 许可证发布。',
          copyright: 'Copyright © sbot contributors',
        },
      },
    },
  },
})
