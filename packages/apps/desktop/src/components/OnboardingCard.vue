<script setup lang="ts">
defineEmits<{ configure: [] }>()
</script>

<template>
  <div class="onboarding">
    <div class="logo">SBot</div>
    <p class="title">欢迎使用 SBot</p>
    <p class="desc">
      还没有配置任何模型。<br />
      添加一个模型后即可开始对话。
    </p>
    <button class="primary" type="button" @click="$emit('configure')">
      配置模型
    </button>
  </div>
</template>

<style scoped>
.onboarding {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px;
  background: var(--chatui-bg, #fafafa);
  color: var(--chatui-fg, #1f2328);
}
.logo {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--chatui-fg-muted, #5f6368);
}
.primary {
  margin-top: 12px;
  padding: 8px 28px;
  border: none;
  border-radius: 8px;
  background: var(--sui-color-primary, #1f2328);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.primary:hover {
  opacity: 0.9;
}
</style>
