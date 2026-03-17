<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiFetch } from '@/api'
import { marked } from 'marked'
import { GITHUB_REPO_URL, GITHUB_ISSUES_URL, GITHUB_RELEASES_API, GITHUB_README_URL } from '@/utils/constants'

const version = ref('')
const readmeHtml = ref('')
const loadingReadme = ref(true)
const update = ref<{ tag: string; body: string; url: string } | null>(null)

const updateBodyHtml = computed(() =>
  update.value?.body ? (marked.parse(update.value.body) as string) : ''
)

function compareSemver(a: string, b: string) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
  }
  return 0
}

onMounted(async () => {
  try {
    const res = await apiFetch('/api/about')
    version.value = res.data?.version || ''
  } catch {}

  const [readmeResult, releaseResult] = await Promise.allSettled([
    fetch(GITHUB_README_URL).then(r => r.text()),
    fetch(GITHUB_RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    }).then(r => r.json()),
  ])

  if (readmeResult.status === 'fulfilled') {
    readmeHtml.value = marked.parse(readmeResult.value) as string
  }
  loadingReadme.value = false

  if (releaseResult.status === 'fulfilled' && version.value) {
    const data = releaseResult.value
    const tag: string = data.tag_name || ''
    if (tag && compareSemver(version.value, tag) < 0) {
      update.value = { tag, body: data.body || '', url: data.html_url || '' }
    }
  }
})
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <span class="page-toolbar-title">关于</span>
      <span v-if="version" style="font-size:12px;color:#9b9b9b;font-family:monospace">v{{ version }}</span>
    </div>
    <div class="page-content">
      <div style="max-width:760px">

        <!-- Project info -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-title">项目信息</div>
          <table style="width:100%;font-size:13px">
            <tbody>
              <tr>
                <td style="padding:8px 0;color:#6b6b6b;width:120px;border-bottom:1px solid #f0efed">版本</td>
                <td style="padding:8px 0;font-family:monospace;border-bottom:1px solid #f0efed">{{ version || '—' }}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0efed">开源地址</td>
                <td style="padding:8px 0;border-bottom:1px solid #f0efed">
                  <a :href="GITHUB_REPO_URL" target="_blank" style="color:#4f46e5;text-decoration:none;font-family:monospace;font-size:12px">{{ GITHUB_REPO_URL.replace('https://', '') }}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b6b6b">许可证</td>
                <td style="padding:8px 0">MIT</td>
              </tr>
            </tbody>
          </table>
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid #f0efed;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;color:#9b9b9b">遇到问题或有建议？欢迎在 GitHub 提交 Issue</span>
            <a :href="GITHUB_ISSUES_URL" target="_blank" class="feedback-btn">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              提交反馈
            </a>
          </div>
        </div>

        <!-- Update banner -->
        <div v-if="update" class="update-banner">
          <div class="update-banner-top">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="update-tag">{{ update.tag }}</span>
              <span style="font-size:13px;font-weight:600;color:#1c1c1c">有新版本可用</span>
            </div>
            <a :href="update.url" target="_blank" class="update-link">查看发布页 →</a>
          </div>
          <div v-if="updateBodyHtml" class="update-body md-content" v-html="updateBodyHtml" />
        </div>

        <!-- README -->
        <div v-if="loadingReadme" class="readme-loading">加载中…</div>
        <div v-else-if="readmeHtml" class="readme-wrap md-content" v-html="readmeHtml" />
        <div v-else style="color:#9b9b9b;font-size:13px">无法加载内容，请检查网络连接。</div>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* Feedback button */
.feedback-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid #d6d4d0;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #3d3d3d;
  text-decoration: none;
  background: #fff;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  white-space: nowrap;
}
.feedback-btn:hover {
  background: #1c1c1c;
  border-color: #1c1c1c;
  color: #fff;
}

/* Update banner */
.update-banner {
  border: 1px solid #fbbf24;
  border-radius: 8px;
  background: #fffbeb;
  padding: 14px 16px;
  margin-bottom: 20px;
}
.update-banner-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.update-tag {
  display: inline-block;
  padding: 2px 8px;
  background: #f59e0b;
  color: #fff;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  font-family: monospace;
}
.update-link {
  font-size: 12px;
  color: #4f46e5;
  text-decoration: none;
}
.update-link:hover { text-decoration: underline; }
.update-body {
  border-top: 1px solid #fde68a;
  padding-top: 10px;
  font-size: 13px;
}

/* README */
.readme-loading {
  color: #9b9b9b;
  font-size: 13px;
  padding: 40px 0;
  text-align: center;
}
.readme-wrap {
  font-size: 13px;
  line-height: 1.75;
  color: #1c1c1c;
}
.readme-wrap :deep(h1) {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 12px;
  color: #1c1c1c;
  line-height: 1.3;
}
.readme-wrap :deep(h2) {
  font-size: 15px;
  font-weight: 700;
  margin: 28px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #e8e6e3;
  color: #1c1c1c;
}
.readme-wrap :deep(h3) {
  font-size: 13px;
  font-weight: 700;
  margin: 16px 0 6px;
  color: #3d3d3d;
}
.readme-wrap :deep(p) {
  margin: 0 0 10px;
  color: #3d3d3d;
}
.readme-wrap :deep(ul), .readme-wrap :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}
.readme-wrap :deep(li) { margin-bottom: 4px; }
.readme-wrap :deep(code) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  background: #f5f4f2;
  padding: 1px 5px;
  border-radius: 4px;
  color: #1c1c1c;
}
.readme-wrap :deep(pre) {
  background: #f5f4f2;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 8px 0 12px;
}
.readme-wrap :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 12px;
  color: #1c1c1c;
}
.readme-wrap :deep(a) {
  color: #4f46e5;
  text-decoration: none;
}
.readme-wrap :deep(a:hover) { text-decoration: underline; }
.readme-wrap :deep(hr) {
  border: none;
  border-top: 1px solid #e8e6e3;
  margin: 20px 0;
}
.readme-wrap :deep(table) {
  width: 100%;
  margin: 8px 0 12px;
  font-size: 12px;
  border-collapse: collapse;
}
.readme-wrap :deep(table th),
.readme-wrap :deep(table td) {
  padding: 6px 10px;
  border: 1px solid #e8e6e3;
  text-align: left;
}
.readme-wrap :deep(table th) {
  background: #fafaf9;
  font-weight: 600;
  color: #6b6b6b;
}
.readme-wrap :deep(blockquote) {
  border-left: 3px solid #d6d4d0;
  margin: 6px 0 10px;
  padding: 4px 12px;
  color: #6b6b6b;
  font-style: italic;
}
/* Badge images row */
.readme-wrap :deep(p) img {
  height: 20px;
  vertical-align: middle;
  margin-right: 4px;
}
</style>
