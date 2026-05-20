// @sbot/ui - 共享 UI 组件库
//
// 使用方式：
//   import '@sbot/ui/tokens/index.css'                 // 顶层入口一次性引入 token
//   import { SButton, SModal } from '@sbot/ui'         // 组件按需引入
//   import { useToast, useTheme } from '@sbot/ui'      // composable

export { default as SButton } from './components/SButton.vue'
export { default as SIconButton } from './components/SIconButton.vue'
export { default as SModal } from './components/SModal.vue'
export { default as SToast } from './components/SToast.vue'

export { default as SInput } from './components/SInput.vue'
export { default as STextarea } from './components/STextarea.vue'
export { default as SSelect } from './components/SSelect.vue'
export { default as SFormItem } from './components/SFormItem.vue'
export { default as SFormSection } from './components/SFormSection.vue'
export { default as SFormDetails } from './components/SFormDetails.vue'
export { default as SHint } from './components/SHint.vue'

export { default as SCard } from './components/SCard.vue'
export { default as SPageToolbar } from './components/SPageToolbar.vue'
export { default as SPageContent } from './components/SPageContent.vue'

export { default as SBadge } from './components/SBadge.vue'
export { default as STag } from './components/STag.vue'
export { default as SChip } from './components/SChip.vue'
export { default as SCheckCard } from './components/SCheckCard.vue'
export { default as SSwitch } from './components/SSwitch.vue'
export { default as STabBar } from './components/STabBar.vue'
export { default as STab } from './components/STab.vue'

export { default as STree } from './components/STree.vue'
export { default as STreeNode } from './components/STreeNode.vue'

export { useToast } from './composables/useToast'
export { useTheme, isDark } from './composables/useTheme'
