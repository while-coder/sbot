<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { marked } from 'marked'
import { GITHUB_REPO_URL, GITHUB_ISSUES_URL, GITHUB_README_URL, GITHUB_README_ZH_URL, NPM_URL, DOCKER_URL, fetchLatestRelease, compareSemver } from 'sbot.commons'
import { SCard, SPageToolbar, SPageContent, SInfoTable, SInfoRow } from 'sbot-ui'

const { t, locale } = useI18n()

const currentVersion = ref('')
const currentNoteEn = ref('')
const currentNoteZh = ref('')
const readmeHtml = ref('')
const loadingReadme = ref(true)
const newRelease = ref<{ tag: string; releasenoteEn: string; releasenoteZh: string; url: string } | null>(null)

const currentNoteHtml = computed(() => {
  const note = (locale.value === 'zh' ? currentNoteZh.value : currentNoteEn.value) || currentNoteEn.value
  return note ? (marked.parse(note) as string) : ''
})
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
    <SPageToolbar :title="t('about.title')">
      <template #actions>
        <span v-if="currentVersion" class="about-version">v{{ currentVersion }}</span>
      </template>
    </SPageToolbar>
    <SPageContent>
      <div class="about-wrap">

        <!-- Project info -->
        <SCard :title="t('about.project_info')" class="about-card">
          <SInfoTable>
            <SInfoRow :label="t('about.version')" mono>{{ currentVersion || '—' }}</SInfoRow>
            <SInfoRow :label="t('about.repository')">
              <a :href="GITHUB_REPO_URL" target="_blank" class="info-link">{{ GITHUB_REPO_URL.replace('https://', '') }}</a>
            </SInfoRow>
            <SInfoRow :label="t('about.npm')">
              <a :href="NPM_URL" target="_blank" class="info-link">{{ NPM_URL.replace('https://', '') }}</a>
            </SInfoRow>
            <SInfoRow :label="t('about.docker')">
              <a :href="DOCKER_URL" target="_blank" class="info-link">{{ DOCKER_URL.replace('https://', '') }}</a>
            </SInfoRow>
            <SInfoRow :label="t('about.license')">MIT</SInfoRow>
          </SInfoTable>
          <div class="feedback-row">
            <span class="feedback-hint">{{ t('about.feedback_hint') }}</span>
            <a :href="GITHUB_ISSUES_URL" target="_blank" class="feedback-btn">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="feedback-icon">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              {{ t('about.feedback') }}
            </a>
          </div>
        </SCard>

        <!-- Release note -->
        <SCard v-if="currentNoteHtml" :title="t('about.release_notes')" class="about-card">
          <div class="releasenote-body md-content" v-html="currentNoteHtml" />
        </SCard>

        <!-- Update banner -->
        <div v-if="newRelease" class="newRelease-banner">
          <div class="newRelease-banner-top">
            <div class="newRelease-banner-left">
              <span class="newRelease-tag">{{ newRelease.tag }}</span>
              <span class="newRelease-title">{{ t('about.new_version') }}</span>
            </div>
            <a :href="newRelease.url" target="_blank" class="newRelease-link">{{ t('about.view_release') }}</a>
          </div>
          <div v-if="latestNoteHtml" class="newRelease-body md-content" v-html="latestNoteHtml" />
        </div>

        <!-- README -->
        <div v-if="loadingReadme" class="readme-loading">{{ t('about.loading') }}</div>
        <div v-else-if="readmeHtml" class="readme-wrap md-content" v-html="readmeHtml" />
        <div v-else class="readme-error">{{ t('about.load_error') }}</div>
      </div>
    </SPageContent>
  </div>
</template>

<style scoped>
.about-version {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
  font-family: var(--sui-font-mono);
}
.about-wrap {
  max-width: 760px;
}
.about-card {
  margin-bottom: var(--sui-sp-6);
}
.info-link {
  color: var(--sui-accent);
  text-decoration: none;
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
}

.feedback-row {
  margin-top: var(--sui-sp-4);
  padding-top: var(--sui-sp-4);
  border-top: 1px solid var(--sui-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.feedback-hint {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-disabled);
}
.feedback-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: 5px 12px;
  border: 1px solid var(--sui-border-strong);
  border-radius: var(--sui-radius-md);
  font-size: var(--sui-fs-sm);
  font-weight: 500;
  color: var(--sui-fg-secondary);
  text-decoration: none;
  background: var(--sui-bg);
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  white-space: nowrap;
}
.feedback-btn:hover {
  background: var(--sui-primary);
  border-color: var(--sui-primary);
  color: var(--sui-on-primary);
}
.feedback-icon { flex-shrink: 0; }

.releasenote-body {
  font-size: var(--sui-fs-md);
  line-height: 1.75;
  color: var(--sui-fg-secondary);
}

.newRelease-banner {
  border: 1px solid var(--sui-warning);
  border-radius: var(--sui-radius-lg);
  background: var(--sui-warning-soft, #fffbeb);
  padding: var(--sui-sp-4) var(--sui-sp-5);
  margin-bottom: var(--sui-sp-6);
}
.newRelease-banner-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sui-sp-3);
}
.newRelease-banner-left {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
}
.newRelease-tag {
  display: inline-block;
  padding: 2px 8px;
  background: var(--sui-warning);
  color: #fff;
  border-radius: var(--sui-radius-sm);
  font-size: var(--sui-fs-sm);
  font-weight: 700;
  font-family: var(--sui-font-mono);
}
.newRelease-title {
  font-size: var(--sui-fs-md);
  font-weight: 600;
  color: var(--sui-fg);
}
.newRelease-link {
  font-size: var(--sui-fs-sm);
  color: var(--sui-accent);
  text-decoration: none;
}
.newRelease-link:hover { text-decoration: underline; }
.newRelease-body {
  border-top: 1px solid var(--sui-warning);
  padding-top: var(--sui-sp-3);
  font-size: var(--sui-fs-md);
  opacity: 0.9;
}

.readme-loading,
.readme-error {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-md);
  padding: 40px 0;
  text-align: center;
}
.readme-wrap {
  font-size: var(--sui-fs-md);
  line-height: 1.75;
  color: var(--sui-fg);
}
.readme-wrap :deep(h1) {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 12px;
  color: var(--sui-fg);
  line-height: 1.3;
}
.readme-wrap :deep(h2) {
  font-size: var(--sui-fs-xl);
  font-weight: 700;
  margin: 28px 0 10px;
  padding-bottom: var(--sui-sp-2);
  border-bottom: 1px solid var(--sui-border);
  color: var(--sui-fg);
}
.readme-wrap :deep(h3) {
  font-size: var(--sui-fs-md);
  font-weight: 700;
  margin: 16px 0 6px;
  color: var(--sui-fg-secondary);
}
.readme-wrap :deep(p) {
  margin: 0 0 10px;
  color: var(--sui-fg-secondary);
}
.readme-wrap :deep(ul), .readme-wrap :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}
.readme-wrap :deep(li) { margin-bottom: 4px; }
.readme-wrap :deep(code) {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-sm);
  background: var(--sui-bg-hover);
  padding: 1px 5px;
  border-radius: var(--sui-radius-sm);
  color: var(--sui-fg);
}
.readme-wrap :deep(pre) {
  background: var(--sui-bg-hover);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  padding: 12px 14px;
  overflow-x: auto;
  margin: 8px 0 12px;
}
.readme-wrap :deep(pre code) {
  background: none;
  padding: 0;
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg);
}
.readme-wrap :deep(a) {
  color: var(--sui-accent);
  text-decoration: none;
}
.readme-wrap :deep(a:hover) { text-decoration: underline; }
.readme-wrap :deep(hr) {
  border: none;
  border-top: 1px solid var(--sui-border);
  margin: 20px 0;
}
.readme-wrap :deep(table) {
  width: 100%;
  margin: 8px 0 12px;
  font-size: var(--sui-fs-sm);
  border-collapse: collapse;
}
.readme-wrap :deep(table th),
.readme-wrap :deep(table td) {
  padding: 6px 10px;
  border: 1px solid var(--sui-border);
  text-align: left;
}
.readme-wrap :deep(table th) {
  background: var(--sui-bg-subtle);
  font-weight: 600;
  color: var(--sui-fg-muted);
}
.readme-wrap :deep(blockquote) {
  border-left: 3px solid var(--sui-border-strong);
  margin: 6px 0 10px;
  padding: 4px 12px;
  color: var(--sui-fg-muted);
  font-style: italic;
}
.readme-wrap :deep(p) img {
  height: 20px;
  vertical-align: middle;
  margin-right: 4px;
}

@media (max-width: 768px) {
  .about-card :deep(td a),
  .readme-wrap :deep(a),
  .readme-wrap :deep(code) {
    word-break: break-all;
  }
  .newRelease-banner-top {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sui-sp-3);
  }
}
</style>
