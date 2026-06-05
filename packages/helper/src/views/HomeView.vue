<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

interface Tool {
  key: string
  label: string
  description: string
  route: string
}

const tools: Tool[] = [
  {
    key: 'xiaoai-login',
    label: '小爱登录',
    description: '登录小米账号，导出 sbot channel.xiaoai 所需的 userId / passToken / loginDeviceId / deviceName',
    route: '/xiaoai-login',
  },
  {
    key: 'keystore-gen',
    label: 'Keystore 生成',
    description: '生成 Android APK 签名 keystore（PKCS12），自动给出 GitHub Actions 所需的 4 个 secret',
    route: '/keystore-gen',
  },
]
</script>

<template>
  <div class="home">
    <p class="lead">挑一个工具开始。完成后复制输出 JSON，粘到 admin 的"粘贴凭据 JSON"入口即可。</p>
    <div class="grid">
      <article v-for="t in tools" :key="t.key" class="card" @click="router.push(t.route)">
        <h2>{{ t.label }}</h2>
        <p>{{ t.description }}</p>
      </article>
    </div>
  </div>
</template>

<style scoped>
.home { max-width: 720px; margin: 0 auto; }
.lead { color: var(--fg-muted); margin-bottom: 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.card {
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 16px; cursor: pointer; transition: border-color 0.15s, transform 0.15s;
}
.card:hover { border-color: var(--primary); transform: translateY(-1px); }
.card h2 { font-size: 15px; font-weight: 600; margin: 0 0 6px; }
.card p { font-size: 13px; color: var(--fg-muted); margin: 0; }
</style>
