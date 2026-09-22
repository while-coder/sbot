// EntityTable 的列类型单独放 .ts：包入口 (index.ts) 需要具名 re-export，
// 而 tsc 不解析 .vue 内部，从 .vue re-export 具名类型会报 TS2614
export type EntityTableColumn = {
  key: string
  label?: string
  /** 单元格具名插槽名，缺省用 key */
  slot?: string
  ellipsis?: boolean
  /** 移动端卡片布局中作为标题列 */
  primary?: boolean
  /** 操作列：卡片布局单独渲染，表格内不换行 */
  ops?: boolean
  width?: string
  align?: "left" | "right" | "center"
}
