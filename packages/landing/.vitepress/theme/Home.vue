<template>
  <div class="home-container">
    <div class="home-card">
      <img src="/logo.svg" alt="sbot" class="home-logo" />
      <h1 class="home-title">sbot</h1>
      <p class="home-tagline">Self-hosted AI Agent Server</p>
      <p class="home-desc">
        Open-source, modular AI agent framework. Models, memory, tools, and channels
        are independent building blocks you mix and match — no vendor lock-in.
      </p>
      <div class="home-install" @click="copyInstall">
        <code>{{ installCmd }}</code>
        <span class="home-copy-hint">{{ copied ? '✓ Copied' : 'Click to copy' }}</span>
      </div>
      <div class="home-actions">
        <a href="/guide/getting-started" class="home-btn home-btn-primary">Get Started →</a>
        <a href="https://github.com/while-coder/sbot" target="_blank" class="home-btn home-btn-secondary">GitHub</a>
        <a href="https://www.npmjs.com/package/@qingfeng346/sbot" target="_blank" class="home-btn home-btn-secondary">npm</a>
      </div>
      <div class="home-badges">
        <img src="https://img.shields.io/npm/v/@qingfeng346/sbot" alt="npm version" />
        <img src="https://img.shields.io/npm/dm/@qingfeng346/sbot" alt="npm downloads" />
        <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js" />
        <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const installCmd = 'npm install -g @qingfeng346/sbot'
const copied = ref(false)

function copyInstall() {
  navigator.clipboard.writeText(installCmd)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>
