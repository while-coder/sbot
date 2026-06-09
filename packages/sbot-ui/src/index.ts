// sbot-ui - 共享 UI 组件库
//
// 使用方式：
//   import 'sbot-ui/tokens/index.css'                 // 顶层入口一次性引入 token
//
//   方式 A — 全局插件注册（模板里直接 <SButton>，无需 import）：
//     import SbotUI from 'sbot-ui'
//     app.use(SbotUI)
//
//   方式 B — 按需具名 import（保留 tree-shaking）：
//     import { SButton, SModal } from 'sbot-ui'
//
//   两种方式可同时混用。

import type { App } from 'vue'

import SButton from './components/SButton.vue'
import SIconButton from './components/SIconButton.vue'
import SModal from './components/SModal.vue'
import SToast from './components/SToast.vue'
import SConfirm from './components/SConfirm.vue'

import SInput from './components/SInput.vue'
import STextarea from './components/STextarea.vue'
import SSelect from './components/SSelect.vue'
import SMultiSelect from './components/SMultiSelect.vue'
import SRadio from './components/SRadio.vue'
import SCheckbox from './components/SCheckbox.vue'
import SFormItem from './components/SFormItem.vue'
import SFormSection from './components/SFormSection.vue'
import SFormDetails from './components/SFormDetails.vue'
import SHint from './components/SHint.vue'

import SCard from './components/SCard.vue'
import SPageToolbar from './components/SPageToolbar.vue'
import SPageContent from './components/SPageContent.vue'
import STable from './components/STable.vue'
import SInfoTable from './components/SInfoTable.vue'
import SInfoRow from './components/SInfoRow.vue'
import SEntityList from './components/SEntityList.vue'

import SBadge from './components/SBadge.vue'
import STag from './components/STag.vue'
import STagInput from './components/STagInput.vue'
import STagFilter from './components/STagFilter.vue'
import SChip from './components/SChip.vue'
import SCheckCard from './components/SCheckCard.vue'
import SSwitch from './components/SSwitch.vue'
import STabBar from './components/STabBar.vue'
import STab from './components/STab.vue'

import STree from './components/STree.vue'
import STreeNode from './components/STreeNode.vue'

// ── 具名 export（方式 B：按需 import） ────────────────────
export {
  SButton, SIconButton, SModal, SToast, SConfirm,
  SInput, STextarea, SSelect, SMultiSelect, SRadio, SCheckbox, SFormItem, SFormSection, SFormDetails, SHint,
  SCard, SPageToolbar, SPageContent, STable, SInfoTable, SInfoRow, SEntityList,
  SBadge, STag, STagInput, STagFilter, SChip, SCheckCard, SSwitch, STabBar, STab,
  STree, STreeNode,
}
export type { STableColumn } from './components/STable.vue'

export { useToast } from './composables/useToast'
export { useTheme, isDark } from './composables/useTheme'
export { useConfirm } from './composables/useConfirm'
export type { ConfirmOptions } from './composables/useConfirm'

// ── 默认 export（方式 A：app.use(SbotUI) 全局注册） ───────
const components = {
  SButton, SIconButton, SModal, SToast, SConfirm,
  SInput, STextarea, SSelect, SMultiSelect, SRadio, SCheckbox, SFormItem, SFormSection, SFormDetails, SHint,
  SCard, SPageToolbar, SPageContent, STable, SInfoTable, SInfoRow, SEntityList,
  SBadge, STag, STagInput, STagFilter, SChip, SCheckCard, SSwitch, STabBar, STab,
  STree, STreeNode,
} as const

export default {
  install(app: App) {
    for (const [name, comp] of Object.entries(components)) {
      app.component(name, comp as any)
    }
  },
}

// ── 全局组件类型增强（让 <SButton> 在模板里有 props 智能提示） ─
declare module 'vue' {
  interface GlobalComponents {
    SButton: typeof SButton
    SIconButton: typeof SIconButton
    SModal: typeof SModal
    SToast: typeof SToast
    SConfirm: typeof SConfirm
    SInput: typeof SInput
    STextarea: typeof STextarea
    SSelect: typeof SSelect
    SMultiSelect: typeof SMultiSelect
    SRadio: typeof SRadio
    SCheckbox: typeof SCheckbox
    SFormItem: typeof SFormItem
    SFormSection: typeof SFormSection
    SFormDetails: typeof SFormDetails
    SHint: typeof SHint
    SCard: typeof SCard
    SPageToolbar: typeof SPageToolbar
    SPageContent: typeof SPageContent
    STable: typeof STable
    SInfoTable: typeof SInfoTable
    SInfoRow: typeof SInfoRow
    SEntityList: typeof SEntityList
    SBadge: typeof SBadge
    STag: typeof STag
    STagInput: typeof STagInput
    STagFilter: typeof STagFilter
    SChip: typeof SChip
    SCheckCard: typeof SCheckCard
    SSwitch: typeof SSwitch
    STabBar: typeof STabBar
    STab: typeof STab
    STree: typeof STree
    STreeNode: typeof STreeNode
  }
}
