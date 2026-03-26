<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { marked } from 'marked'
import { GITHUB_REPO_URL, GITHUB_ISSUES_URL, GITHUB_README_URL, GITHUB_README_ZH_URL, NPM_URL, DOCKER_URL, fetchLatestRelease, compareSemver } from 'sbot.commons'

const { t, locale } = useI18n()

const currentVersion = ref('')
const currentNoteEn = ref('')
const currentNoteZh = ref('')
const readmeHtml = ref('')
const loadingReadme = ref(true)
const newRelease = ref<{ tag: string; releasenoteEn: string; releasenoteZh: string; url: string } | null>(null)

// 当前已安装版本的更新内容
const currentNoteHtml = computed(() => {
  const note = (locale.value === 'zh' ? currentNoteZh.value : currentNoteEn.value) || currentNoteEn.value
  return note ? (marked.parse(note) as string) : ''
})
// 最新版本的更新内容
const latestNoteHtml = computed(() => {
  const note = (locale.value === 'zh' ? newRelease.value?.releasenoteZh : newRelease.value?.releasenoteEn) || newRelease.value?.releasenoteEn || ''
  return note ? (marked.parse(note) as string) : ''
})

onMounted(async () => {
  try {
    const res = await apiFetch('/api/about')
    currentVersion.value = res.data?.version || ''
    currentNoteEn.value = res.data?.releasenoteEn || ''
    currentNoteZh.value = res.data?.releasenoteZh || ''
  } catch {}

  const readmeUrl = locale.value === 'zh' ? GITHUB_README_ZH_URL : GITHUB_README_URL
  const [readmeResult, releaseResult] = await Promise.allSettled([
    fetch(readmeUrl).then(r => r.text()),
    fetchLatestRelease(),
  ])

  if (readmeResult.status === 'fulfilled') {
    readmeHtml.value = marked.parse(readmeResult.value) as string
  }
  loadingReadme.value = false

  if (releaseResult.status === 'fulfilled' && releaseResult.value && currentVersion.value) {
    const data = releaseResult.value
    const tag = data.tag || ''
    if (tag && compareSemver(currentVersion.value, tag) < 0) {
      newRelease.value = { tag, releasenoteEn: data.releasenoteEn, releasenoteZh: data.releasenoteZh, url: data.url }
    }
  }
})
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <span class="page-toolbar-title">{{ t('about.title') }}</span>
      <span v-if="currentVersion" style="font-size:12px;color:#9b9b9b;font-family:monospace">v{{ currentVersion }}</span>
    </div>
    <div class="page-content">
      <div style="max-width:760px">

        <!-- Project info -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-title">{{ t('about.project_info') }}</div>
          <table style="width:100%;font-size:13px">
            <tbody>
              <tr>
                <td style="padding:8px 0;color:#6b6b6b;width:120px;border-bottom:1px solid #f0efed">{{ t('about.version') }}</td>
                <td style="padding:8px 0;font-family:monospace;border-bottom:1px solid #f0efed">{{ currentVersion || '—' }}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0efed">{{ t('about.repository') }}</td>
                <td style="padding:8px 0;border-bottom:1px solid #f0efed">
                  <a :href="GITHUB_REPO_URL" target="_blank" style="color:#4f46e5;text-decoration:none;font-family:monospace;font-size:12px">{{ GITHUB_REPO_URL.replace('https://', '') }}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0efed">{{ t('about.npm') }}</td>
                <td style="padding:8px 0;border-bottom:1px solid #f0efed">
                  <a :href="NPM_URL" target="_blank" style="color:#4f46e5;text-decoration:none;font-family:monospace;font-size:12px">{{ NPM_URL.replace('https://', '') }}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0efed">{{ t('about.docker') }}</td>
                <td style="padding:8px 0;border-bottom:1px solid #f0efed">
                  <a :href="DOCKER_URL" target="_blank" style="color:#4f46e5;text-decoration:none;font-family:monospace;font-size:12px">{{ DOCKER_URL.replace('https://', '') }}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b6b6b">{{ t('about.license') }}</td>
                <td style="padding:8px 0">MIT</td>
              </tr>
            </tbody>
          </table>
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid #f0efed;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;color:#9b9b9b">{{ t('about.feedback_hint') }}</span>
            <a :href="GITHUB_ISSUES_URL" target="_blank" class="feedback-btn">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              {{ t('about.feedback') }}
            </a>
          </div>
        </div>

        <!-- Release note -->
        <div v-if="currentNoteHtml" class="releasenote-card" style="margin-bottom:20px">
          <div class="card-title">{{ t('about.release_notes') }}</div>
          <div class="releasenote-body md-content" v-html="currentNoteHtml" />
        </div>

        <!-- Update banner -->
        <div v-if="newRelease" class="newRelease-banner">
          <div class="newRelease-banner-top">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="newRelease-tag">{{ newRelease.tag }}</span>
              <span style="font-size:13px;font-weight:600;color:#1c1c1c">{{ t('about.new_version') }}</span>
            </div>
            <a :href="newRelease.url" target="_blank" class="newRelease-link">{{ t('about.view_release') }}</a>
          </div>
          <div v-if="latestNoteHtml" class="newRelease-body md-content" v-html="latestNoteHtml" />
        </div>

        <!-- README -->
        <div v-if="loadingReadme" class="readme-loading">{{ t('about.loading') }}</div>
        <div v-else-if="readmeHtml" class="readme-wrap md-content" v-html="readmeHtml" />
        <div v-else style="color:#9b9b9b;font-size:13px">{{ t('about.load_error') }}</div>

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

/* Release note */
.releasenote-card {
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  background: #fff;
  padding: 14px 16px;
}
.releasenote-body {
  font-size: 13px;
  line-height: 1.75;
  color: #3d3d3d;
  margin-top: 10px;
}

/* Update banner */
.newRelease-banner {
  border: 1px solid #fbbf24;
  border-radius: 8px;
  background: #fffbeb;
  padding: 14px 16px;
  margin-bottom: 20px;
}
.newRelease-banner-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.newRelease-tag {
  display: inline-block;
  padding: 2px 8px;
  background: #f59e0b;
  color: #fff;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  font-family: monospace;
}
.newRelease-link {
  font-size: 12px;
  color: #4f46e5;
  text-decoration: none;
}
.newRelease-link:hover { text-decoration: underline; }
.newRelease-body {
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
