<template>
  <div class="home-container">
    <div class="home-card">
      <img src="/logo.svg" alt="sbot" class="home-logo" />
      <h1 class="home-title">sbot</h1>
      <p class="home-tagline">{{ t.tagline }}</p>
      <p class="home-desc">{{ t.desc }}</p>
      <div class="home-install" @click="copyInstall">
        <code>{{ installCmd }}</code>
        <span class="home-copy-hint">{{ copied ? t.copied : t.copyHint }}</span>
      </div>
      <div class="home-actions">
        <a :href="t.getStartedLink" class="home-btn home-btn-primary">{{ t.getStarted }}</a>
        <a href="https://github.com/while-coder/sbot" target="_blank" class="home-btn home-btn-secondary">GitHub</a>
        <a href="https://www.npmjs.com/package/@qingfeng346/sbot" target="_blank" class="home-btn home-btn-secondary">npm</a>
      </div>
      <div class="home-badges">
        <img src="https://img.shields.io/npm/v/@qingfeng346/sbot" alt="npm version" />
        <img src="https://img.shields.io/npm/dm/@qingfeng346/sbot" alt="npm downloads" />
        <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js" />
        <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" />
      </div>
      <ul class="home-highlights">
        <li v-for="(item, i) in t.highlights" :key="i" v-html="item"></li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useData } from 'vitepress'

const installCmd = 'npm install -g @qingfeng346/sbot'
const copied = ref(false)

const { lang } = useData()

const messages = {
  'en-US': {
    tagline: 'Self-hosted AI Agent Server',
    desc: 'Open-source, modular AI agent framework. Models, memory, tools, channels, and skills are independent building blocks you mix and match — run on your own server with multi-channel integrations, MCP/ACP support, and a built-in Web UI. No vendor lock-in.',
    copyHint: 'Click to copy',
    copied: '✓ Copied',
    getStarted: 'Get Started →',
    getStartedLink: '/sbot/guide/getting-started',
    highlights: [
      '<strong>Multi-provider</strong> — OpenAI · Claude · Gemini · Ollama · any OpenAI-compatible API',
      '<strong>Multi-channel</strong> — Web · CLI · Lark · Slack · WeCom · WeChat · OneBot · XiaoAI · REST · WS',
      '<strong>Multi-mode agents</strong> — Single · ReAct · Generative, plus ACP integration',
      '<strong>Long-term recall</strong> — Notes (vector) · Wiki (hybrid keyword + semantic) · Insight',
      '<strong>Proactive runtime</strong> — Heartbeat · cron Scheduler · Todo · Ask',
    ],
  },
  'zh-CN': {
    tagline: '自托管 AI Agent 服务',
    desc: '开源、模块化的 AI Agent 框架。模型、记忆、工具、渠道、技能均为独立模块，自由组合 —— 在自己的服务器上运行，支持多渠道接入、MCP/ACP 协议和内置 Web UI，无供应商绑定。',
    copyHint: '点击复制',
    copied: '✓ 已复制',
    getStarted: '快速开始 →',
    getStartedLink: '/sbot/zh/guide/getting-started',
    highlights: [
      '<strong>多供应商</strong> — OpenAI · Claude · Gemini · Ollama · 任意 OpenAI 兼容接口',
      '<strong>多渠道</strong> — Web · CLI · 飞书 · Slack · 企业微信 · 微信 · OneBot · 小爱 · REST · WS',
      '<strong>多模式 Agent</strong> — Single · ReAct · Generative，外加 ACP 集成',
      '<strong>长期记忆</strong> — Notes（向量）· Wiki（关键词 + 语义混合）· Insight',
      '<strong>主动运行时</strong> — 心跳 · cron 调度器 · 待办 · 提问',
    ],
  },
}

const t = computed(() => messages[lang.value as keyof typeof messages] || messages['en-US'])

function copyInstall() {
  navigator.clipboard.writeText(installCmd)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>
