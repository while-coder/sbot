
import type { App, Component } from "vue"
import * as components from "./components"

export type { SelectOption } from "./components/SSelect.vue"
export type { MultiSelectOption } from "./components/SMultiSelect.vue"
export type { EntityTableColumn } from "./components/SEntityTable.types"
export type { TreeOption } from "./components/STree.vue"
export type { DataTableColumn } from "./components/SDataTable.vue"
export { toast, confirm, loading } from "./composables/message"
export type { LoadingHandle, ConfirmOptions } from "./composables/message"
//主题响应式探测：MutationObserver 跟随 html[data-theme]，与 styles/theme-dark.css 约定一致
export { useTheme, isDark } from "./composables/useTheme"
//浮窗栈：SFloatWindow 的模块级 z 序/焦点状态（父组件读取当前焦点窗用）
export { useFloatWindowStack } from "./components/SFloatWindow.vue"
//排序组件对的公共面：SSortableList/SSortableItem 组件 + key 工具 + 行控制器类型（独立传 sort prop 时用）
export { sortableItemKey } from "./components/sortable/SSortableList.vue"
export type { DropEdge, SortableItemController } from "./components/sortable/SSortableList.vue"

//可停靠工作区：组件 + 布局树引擎（引擎收在 SDockWorkspace.vue 内，命名空间导出避免与其它模块撞名）
export * as dockTree from "./components/dock/SDockWorkspace.vue"
export type { DockItem, WorkspaceSnapshot } from "./components/dock/SDockWorkspace.vue"
export * from "./components"

const registeredComponents = Object.entries(components).filter(
  ([name, value]) => name.startsWith("S") && typeof value === "object"
) as [string, Component][]

export function createUiKit() {
  return {
    install(app: App) {
      for (const [name, component] of registeredComponents) app.component(name, component)
    }
  }
}

// ── 全局组件类型增强(createUiKit 全局注册后,模板里 <SButton> 有 props 提示) ──
declare module "vue" {
  export interface GlobalComponents {
  SAlert: typeof components.SAlert
  SAutoComplete: typeof components.SAutoComplete
  SButton: typeof components.SButton
  SCard: typeof components.SCard
  SCheckbox: typeof components.SCheckbox
  SCheckboxGroup: typeof components.SCheckboxGroup
  SCollapse: typeof components.SCollapse
  SCollapseItem: typeof components.SCollapseItem
  SDataTable: typeof components.SDataTable
  SDropdown: typeof components.SDropdown
  SFloatWindow: typeof components.SFloatWindow
  SEllipsis: typeof components.SEllipsis
  SEmpty: typeof components.SEmpty
  SMessageHost: typeof components.SMessageHost
  SIconButton: typeof components.SIconButton
  SSortableItem: typeof components.SSortableItem
  SSortableList: typeof components.SSortableList
  SDockWorkspace: typeof components.SDockWorkspace
  SDockTabbar: typeof components.SDockTabbar
  SDockTabDrawer: typeof components.SDockTabDrawer
  SFlex: typeof components.SFlex
  SForm: typeof components.SForm
  SFormItem: typeof components.SFormItem
  SGrid: typeof components.SGrid
  SGridItem: typeof components.SGridItem
  SInput: typeof components.SInput
  SInputGroup: typeof components.SInputGroup
  SLayout: typeof components.SLayout
  SLayoutContent: typeof components.SLayoutContent
  SLayoutHeader: typeof components.SLayoutHeader
  SList: typeof components.SList
  SListItem: typeof components.SListItem
  SLog: typeof components.SLog
  SModal: typeof components.SModal
  SScrollbar: typeof components.SScrollbar
  SSelect: typeof components.SSelect
  SSlider: typeof components.SSlider
  SSpace: typeof components.SSpace
  SSpin: typeof components.SSpin
  SSplit: typeof components.SSplit
  SSwitch: typeof components.SSwitch
  STab: typeof components.STab
  STable: typeof components.STable
  STabPane: typeof components.STabPane
  STabs: typeof components.STabs
  STag: typeof components.STag
  STagFilter: typeof components.STagFilter
  STagInput: typeof components.STagInput
  STextarea: typeof components.STextarea
  SBadge: typeof components.SBadge
  SCheckCard: typeof components.SCheckCard
  SChip: typeof components.SChip
  SEntityList: typeof components.SEntityList
  SEntityTable: typeof components.SEntityTable
  STreePanel: typeof components.STreePanel
  STreeRow: typeof components.STreeRow
  STabBar: typeof components.STabBar
  SNavTab: typeof components.SNavTab
  SFormDetails: typeof components.SFormDetails
  SFormSection: typeof components.SFormSection
  SHint: typeof components.SHint
  SInfoRow: typeof components.SInfoRow
  SInfoTable: typeof components.SInfoTable
  SMultiSelect: typeof components.SMultiSelect
  SPageContent: typeof components.SPageContent
  SPageToolbar: typeof components.SPageToolbar
  SRadio: typeof components.SRadio
  SThing: typeof components.SThing
  STree: typeof components.STree
  SVirtualList: typeof components.SVirtualList
  }
}
