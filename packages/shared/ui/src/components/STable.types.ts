// STable 的列类型单独放 .ts：包入口 (index.ts) 需要具名 re-export，
// 而 tsc 不解析 .vue 内部，从 .vue re-export 具名类型会报 TS2614
export type STableColumn = {
  key: string
  label?: string
  slot?: string
  ellipsis?: boolean
  primary?: boolean
  ops?: boolean
  width?: string
  align?: 'left' | 'right' | 'center'
}
