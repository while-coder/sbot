<script setup lang="ts">
// 资源「被引用情况」展示，复刻 AgentsView 的 badge + References 卡片。
// mode="badge"：名称列旁的小标签（未被引用 / N 处引用）。
// mode="card" ：展开区里的引用方明细卡片。
import { useI18n } from 'vue-i18n'
import { SCard, SInfoTable, SInfoRow } from 'sbot-ui'
import type { ResourceRefsValue } from '@/composables/useResourceRefs'

defineProps<{ refs: ResourceRefsValue; mode: 'badge' | 'card' }>()

const { t } = useI18n()
</script>

<template>
  <template v-if="mode === 'badge'">
    <span v-if="refs.total === 0" class="config-badge config-badge-unused">{{ t('common.ref_unused') }}</span>
    <span v-else class="config-badge config-badge-ref">{{ t('common.ref_count', { n: refs.total }) }}</span>
  </template>

  <SCard v-else :title="t('common.references')" class="refs-card">
    <div v-if="refs.total === 0" class="ref-empty">{{ t('common.ref_unused_hint') }}</div>
    <SInfoTable v-else variant="compact" label-width="140px">
      <SInfoRow v-if="refs.channels.length" :label="t('common.ref_channels')">
        <span v-for="c in refs.channels" :key="c.id" class="ref-chip">{{ c.name }}</span>
      </SInfoRow>
      <SInfoRow v-if="refs.profiles.length" :label="t('common.ref_profiles')">
        <span v-for="p in refs.profiles" :key="p.id" class="ref-chip">
          {{ p.name }}<span v-if="p.sessionCount" class="ref-chip-sub">{{ t('common.ref_profile_sessions', { n: p.sessionCount }) }}</span>
        </span>
      </SInfoRow>
      <SInfoRow v-if="refs.sessions.length" :label="t('common.ref_sessions')">
        <span v-for="s in refs.sessions" :key="s.id" class="ref-chip">{{ s.name }}</span>
      </SInfoRow>
      <SInfoRow v-if="refs.agents.length" :label="t('common.ref_agents')">
        <span v-for="a in refs.agents" :key="a.id" class="ref-chip">{{ a.name }}</span>
      </SInfoRow>
    </SInfoTable>
  </SCard>
</template>

<style scoped>
.config-badge {
  display: inline-block;
  font-size: var(--sui-fs-xs);
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  margin-left: var(--sui-sp-3);
  vertical-align: middle;
}
.config-badge-ref { background: #dcfce7; color: #15803d; }
.config-badge-unused { background: #fee2e2; color: #b91c1c; }

.refs-card { margin-bottom: var(--sui-sp-4); }
.ref-empty {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
}
.ref-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--sui-bg-hover);
  color: var(--sui-fg);
  font-size: var(--sui-fs-sm);
  padding: 1px 8px;
  border-radius: var(--sui-radius-sm);
  margin: 2px 6px 2px 0;
}
.ref-chip-sub {
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xs);
}

html[data-theme="dark"] .config-badge-ref { background: #14432a; color: #86efac; }
html[data-theme="dark"] .config-badge-unused { background: #4c1d1d; color: #fca5a5; }
</style>
