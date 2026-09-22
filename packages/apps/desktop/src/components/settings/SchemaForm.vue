<script setup lang="ts">
import { computed } from 'vue'
import { SInput, SSelect, SSwitch, SFormItem } from '@sbot/ui-kit'
import { isConfigFieldVisible } from '../../lib/configField'
import type { ConfigField } from '../../lib/configField'

const props = defineProps<{
  /** provider / channel 的 configSchema（key → ConfigField） */
  schema: Record<string, ConfigField>
  /** 表单 config 对象（父组件持有，本组件原地写入 config[key]） */
  config: Record<string, any>
}>()

const entries = computed(() =>
  Object.entries(props.schema).filter(([, field]) => isConfigFieldVisible(field, props.config)),
)
</script>

<template>
  <SFormItem
    v-for="[key, field] in entries"
    :key="key"
    :label="field.label + (field.required ? ' *' : '')"
  >
    <SSelect
      v-if="field.type === 'select'"
      v-model:value="config[key]"
      :options="field.options ?? []"
    />
    <SSwitch v-else-if="field.type === 'boolean'" v-model:value="config[key]" />
    <SInput
      v-else-if="field.type === 'number'"
      v-model:value.number="config[key]"
      type="number"
      :placeholder="field.description || ''"
    />
    <SInput
      v-else-if="field.type === 'password'"
      v-model:value="config[key]"
      type="password"
      :placeholder="field.description || ''"
    />
    <SInput
      v-else-if="field.type === 'textarea'"
      v-model:value="config[key]"
      type="textarea"
      :placeholder="field.description || ''"
    />
    <SInput
      v-else
      v-model:value="config[key]"
      :placeholder="field.description || ''"
    />
    <template v-if="field.type === 'qrcode'" #hint>桌面端不支持扫码，请直接粘贴内容</template>
    <template v-else-if="field.description && field.type !== 'boolean'" #hint>{{ field.description }}</template>
  </SFormItem>
</template>
