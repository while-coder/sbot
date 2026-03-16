<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiFetch } from '@/api'

const version = ref('')
const repoUrl = 'https://github.com/while-coder/sbot'

onMounted(async () => {
  try {
    const res = await apiFetch('/api/about')
    version.value = res.data?.version || ''
  } catch {}
})
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <span class="page-toolbar-title">关于</span>
    </div>
    <div class="page-content" style="max-width:600px">
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
          <div>
            <div style="font-size:22px;font-weight:700;color:#1c1c1c">SBot</div>
            <div style="font-size:13px;color:#9b9b9b;margin-top:2px">v{{ version }}</div>
          </div>
        </div>
        <p style="font-size:13px;color:#3d3d3d;line-height:1.7">
          基于大语言模型的智能对话机器人，支持 Lark（飞书）等多渠道接入，提供灵活的 Agent 管理、会话存储、知识记忆与工具调用能力。
        </p>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-title">项目信息</div>
        <table style="width:100%;font-size:13px">
          <tbody>
            <tr>
              <td style="padding:8px 0;color:#6b6b6b;width:120px;border-bottom:1px solid #f0efed">版本</td>
              <td style="padding:8px 0;font-family:monospace;border-bottom:1px solid #f0efed">{{ version }}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0efed">开源地址</td>
              <td style="padding:8px 0;border-bottom:1px solid #f0efed">
                <a :href="repoUrl" target="_blank" style="color:#4f46e5;text-decoration:none;font-family:monospace;font-size:12px">{{ repoUrl }}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0efed">许可证</td>
              <td style="padding:8px 0;border-bottom:1px solid #f0efed">MIT</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-title">主要功能</div>
        <ul style="font-size:13px;color:#3d3d3d;line-height:1.9;padding-left:20px;margin:0">
          <li>多频道接入（Lark / 飞书）</li>
          <li>灵活的 Agent 配置与多 LLM 支持</li>
          <li>会话历史存储（Saver）</li>
          <li>长期记忆与向量检索（Memory）</li>
          <li>MCP 工具调用集成</li>
          <li>技能（Skill）扩展系统</li>
          <li>计划任务调度</li>
        </ul>
      </div>
    </div>
  </div>
</template>
