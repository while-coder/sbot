<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResponsive } from '../composables/useResponsive'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const { isMobile } = useResponsive()

interface UserRow {
  id: number
  userId: string
  userName: string
  userInfo: string
  channelId: string
}

const { show } = useToast()
const users = ref<UserRow[]>([])
const loading = ref(false)
const viewUser = ref<UserRow | null>(null)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch('/api/channel-users')
    users.value = res.data || []
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    loading.value = false
  }
}

async function remove(user: UserRow) {
  if (!window.confirm(t('users.confirm_delete', { name: user.userName || user.userId }))) return
  try {
    await apiFetch(`/api/channel-users/${user.id}`, 'DELETE')
    show(t('common.deleted'))
    await load()
  } catch (e: any) {
    show(e.message, 'error')
  }
}

function formatUserInfo(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

onMounted(load)
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div class="page-toolbar">
      <span class="page-toolbar-title">{{ t('nav.app_title') }}</span>
      <button class="btn-outline btn-sm" @click="load">{{ t('common.refresh') }}</button>
    </div>
    <div class="page-content">
      <table v-if="!isMobile">
        <thead>
          <tr>
            <th>{{ t('common.id') }}</th>
            <th>{{ t('users.user_id_col') }}</th>
            <th>{{ t('users.username_col') }}</th>
            <th>{{ t('users.channel_col') }}</th>
            <th>{{ t('common.ops') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" style="text-align:center;color:#9b9b9b;padding:40px">{{ t('common.loading') }}</td>
          </tr>
          <tr v-else-if="users.length === 0">
            <td colspan="5" style="text-align:center;color:#9b9b9b;padding:40px">{{ t('users.empty') }}</td>
          </tr>
          <tr v-for="u in users" :key="u.id">
            <td style="font-family:monospace;color:#9b9b9b">{{ u.id }}</td>
            <td style="font-family:monospace">{{ u.userId }}</td>
            <td>{{ u.userName || '-' }}</td>
            <td style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ u.channel || '-' }}</td>
            <td>
              <div class="ops-cell">
                <button class="btn-outline btn-sm" @click="viewUser = u">{{ t('common.view') }}</button>
                <button class="btn-danger btn-sm" @click="remove(u)">{{ t('common.delete') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile card layout -->
      <div v-else class="card-list">
        <div v-if="loading" class="mobile-card-empty">{{ t('common.loading') }}</div>
        <div v-else-if="users.length === 0" class="mobile-card-empty">{{ t('users.empty') }}</div>
        <div v-for="u in users" :key="u.id" class="mobile-card">
          <div class="mobile-card-header">{{ u.userName || '-' }}</div>
          <div class="mobile-card-fields">
            <span class="mobile-card-label">{{ t('common.id') }}</span>
            <span class="mobile-card-value" style="font-family:monospace;color:#9b9b9b">{{ u.id }}</span>
            <span class="mobile-card-label">{{ t('users.user_id_col') }}</span>
            <span class="mobile-card-value" style="font-family:monospace">{{ u.userId }}</span>
            <span class="mobile-card-label">{{ t('users.channel_col') }}</span>
            <span class="mobile-card-value" style="font-family:monospace;font-size:12px;color:#6b6b6b">{{ u.channel || '-' }}</span>
          </div>
          <div class="mobile-card-ops">
            <button class="btn-outline btn-sm" @click="viewUser = u">{{ t('common.view') }}</button>
            <button class="btn-danger btn-sm" @click="remove(u)">{{ t('common.delete') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="viewUser" class="modal-overlay" @click.self="viewUser = null">
      <div class="modal-box wide">
        <div class="modal-header">
          <h3>{{ t('users.detail_title', { name: viewUser.userName || viewUser.userId }) }}</h3>
          <button class="modal-close" @click="viewUser = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>{{ t('common.id') }}</label>
            <input :value="viewUser.id" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('users.user_id') }}</label>
            <input :value="viewUser.userId" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('users.username') }}</label>
            <input :value="viewUser.userName" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('users.channel') }}</label>
            <input :value="viewUser.channel" disabled />
          </div>
          <div class="form-group">
            <label>{{ t('users.user_info') }}</label>
            <textarea :value="formatUserInfo(viewUser.userInfo)" disabled rows="16" style="font-family:monospace;font-size:12px" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" @click="viewUser = null">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
