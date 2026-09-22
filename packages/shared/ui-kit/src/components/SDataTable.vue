<script lang="ts">
import { computed, defineComponent, h, reactive, ref, unref, watch, type CSSProperties, type PropType, type Ref } from "vue"
import type { SelectOption } from "./SSelect.vue"

export interface DataTableColumn {
  title?: string
  key?: string
  width?: number
  minWidth?: number
  resizable?: boolean
  align?: "left" | "center" | "right"
  ellipsis?: boolean
  render?: (row: any, index: number) => unknown
  sorter?: (left: any, right: any) => number
  filterOptions?: SelectOption[] | Ref<SelectOption[]>
  filter?: (value: unknown, row: any) => boolean
}

function valueAt(row: any, path?: string): unknown {
  if (!path) return ""
  return path.split(".").reduce((value, key) => value?.[key], row)
}

const px = (value: string | number | undefined, fallback = 8) =>
  typeof value === "number" ? `${value}px` : (value ?? `${fallback}px`)

export default defineComponent({
  name: "SDataTable",
  inheritAttrs: false,
  props: {
    columns: { type: Array as PropType<any[]>, default: () => [] },
    data: { type: Array as PropType<any[]>, default: () => [] },
    rowProps: Function as PropType<(row: any) => Record<string, unknown>>,
    maxHeight: [String, Number],
    minHeight: [String, Number],
    //表格本身的宽高约束：外层负责滚动，宽列场景不能只给滚动容器设最小宽度。
    tableStyle: Object as PropType<CSSProperties | undefined>,
    expandable: { type: Boolean, default: false },
    expandedKeys: { type: Array as PropType<(string | number)[]>, default: undefined },
    defaultExpandedKeys: { type: Array as PropType<(string | number)[]>, default: () => [] },
    rowKey: { type: [String, Function] as PropType<string | ((row: any, index: number) => string | number)>, default: undefined },
    renderExpand: { type: Function as PropType<(row: any, index: number) => unknown>, default: undefined },
  },
  emits: ["update:expandedKeys", "expand"],
  setup(props, { attrs, emit }) {
    const sortKey = ref("")
    const sortDirection = ref<1 | -1>(1)
    const filters = reactive<Record<string, unknown>>({})
    const columnWidths = reactive<Record<string, number>>({})
    const rows = computed(() => {
      let result = [...props.data]
      for (const column of props.columns) {
        const key = column.key ?? ""
        if (column.filter && filters[key] !== undefined && filters[key] !== "") result = result.filter(row => column.filter?.(filters[key], row))
      }
      const column = props.columns.find(item => item.key === sortKey.value)
      if (column?.sorter) result.sort((left, right) => sortDirection.value * column.sorter!(left, right))
      return result
    })

    const isControlled = computed(() => props.expandedKeys !== undefined)
    const internalExpanded = ref<Set<string | number>>(new Set(props.defaultExpandedKeys ?? []))
    const expandedSet = computed(() => isControlled.value ? new Set(props.expandedKeys) : internalExpanded.value)
    watch(() => props.expandedKeys, value => { if (value !== undefined) internalExpanded.value = new Set(value) })

    function getRowKey(row: any, index: number): string | number {
      const rk = props.rowKey
      if (typeof rk === "function") return rk(row, index)
      if (typeof rk === "string") return row[rk] ?? row.key ?? row.uuid ?? index
      return row.key ?? row.uuid ?? index
    }
    function isExpanded(key: string | number): boolean { return expandedSet.value.has(key) }
    function toggleExpand(row: any, key: string | number): void {
      const next = new Set(expandedSet.value)
      const willExpand = !next.has(key)
      if (willExpand) next.add(key)
      else next.delete(key)
      if (!isControlled.value) internalExpanded.value = next
      emit("update:expandedKeys", Array.from(next))
      emit("expand", row, willExpand)
    }

    const totalCols = computed(() => props.columns.length + (props.expandable ? 1 : 0))
    const columnKey = (column: DataTableColumn, index: number) => String(column.key ?? index)
    const columnWidth = (column: DataTableColumn, index: number) => columnWidths[columnKey(column, index)] ?? column.width
    const StartResize = (event: PointerEvent, column: DataTableColumn, index: number) => {
      event.preventDefault()
      event.stopPropagation()
      const header = (event.currentTarget as HTMLElement).parentElement
      const startWidth = columnWidth(column, index) ?? header?.getBoundingClientRect().width ?? column.minWidth ?? 120
      const minWidth = column.minWidth ?? 72
      const startX = event.clientX
      const onMove = (moveEvent: PointerEvent) => {
        columnWidths[columnKey(column, index)] = Math.max(minWidth, Math.round(startWidth + moveEvent.clientX - startX))
      }
      const onUp = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp, { once: true })
    }

    return () => h("div", { ...attrs, class: ["s-data-table", attrs.class], style: [{ maxHeight: props.maxHeight == null ? undefined : px(props.maxHeight as any), minHeight: props.minHeight == null ? undefined : px(props.minHeight as any) }, attrs.style] }, h("table", { class: ["s-table", { resizable: props.columns.some(column => column.resizable) }], style: props.tableStyle }, [
      h("thead", h("tr", [
        ...(props.expandable ? [h("th", { class: "s-table-expand-th" })] : []),
        ...props.columns.map((column, index) => h("th", { "aria-sort": sortKey.value === column.key ? (sortDirection.value === 1 ? "ascending" : "descending") : column.sorter ? "none" : undefined, style: { width: columnWidth(column, index) == null ? undefined : px(columnWidth(column, index)), minWidth: column.minWidth == null ? undefined : px(column.minWidth), textAlign: column.align } }, [
          h("div", { class: "s-table-heading" }, [column.sorter ? h("button", { type: "button", class: ["s-table-sort", { active: sortKey.value === column.key }], title: String(column.title ?? ""), onClick: () => { if (sortKey.value === column.key) sortDirection.value = sortDirection.value === 1 ? -1 : 1; else { sortKey.value = column.key ?? ""; sortDirection.value = 1 } } }, `${column.title ?? ""}${sortKey.value === column.key ? (sortDirection.value === 1 ? " ↑" : " ↓") : ""}`) : h("span", { title: String(column.title ?? "") }, column.title ?? ""),
            unref(column.filterOptions)?.length ? h("select", { class: "s-table-filter", value: filters[column.key ?? ""] ?? "", "aria-label": `筛选${column.title ?? ""}`, onChange: (event: Event) => { filters[column.key ?? ""] = (event.target as HTMLSelectElement).value } }, [h("option", { value: "" }, "全部"), ...unref(column.filterOptions).map(option => h("option", { value: option.value }, typeof option.label === "string" ? option.label : String(option.value ?? "")))]) : null
          ]),
          column.resizable ? h("span", { class: "s-table-resize", role: "separator", tabindex: 0, title: "拖动调整列宽", "aria-label": `调整${column.title ?? ""}列宽`, onPointerdown: (event: PointerEvent) => StartResize(event, column, index) }) : null
        ]))
      ])),
      h("tbody", rows.value.length ? rows.value.flatMap((row, index) => {
        const key = getRowKey(row, index)
        const expanded = props.expandable && isExpanded(key)
        const rowAttrs = props.rowProps?.(row) ?? {}
        const rowOnClick = rowAttrs.onClick as ((event: MouseEvent) => void) | undefined
        const mainRow = h("tr", {
          ...rowAttrs,
          key,
          class: [rowAttrs.class, { "s-table-row--expandable": props.expandable, "s-table-row--expanded": expanded }],
          onClick: (event: MouseEvent) => {
            rowOnClick?.(event)
            if (event.defaultPrevented) return
            if (!props.expandable || (event.target as HTMLElement).closest("button, input, select, textarea, a")) return
            toggleExpand(row, key)
          },
        }, [
          ...(props.expandable ? [h("td", { class: "s-table-expand-cell" }, h("button", {
            type: "button",
            class: "s-table-expand-button",
            "aria-label": expanded ? "收起详情" : "展开详情",
            "aria-expanded": expanded,
            onClick: (event: MouseEvent) => { event.stopPropagation(); toggleExpand(row, key) },
          }, h("span", { class: "s-table-expand-icon", "aria-hidden": "true" }, expanded ? "▼" : "▶")))] : []),
          ...props.columns.map(column => h("td", { class: { "s-table-cell--ellipsis": column.ellipsis }, style: { textAlign: column.align } }, column.render ? column.render(row, index) as any : String(valueAt(row, column.key) ?? "")))
        ])
        if (!props.expandable || !expanded) return [mainRow]
        const expandRow = h("tr", { class: "s-table-expanded-row", key: `${key}__expand` }, [
          h("td", { class: "s-table-expanded-spacer", "aria-hidden": "true" }),
          h("td", { colspan: props.columns.length, class: "s-table-expanded-cell" }, props.renderExpand?.(row, index) as any),
        ])
        return [mainRow, expandRow]
      }) : h("tr", h("td", { colspan: totalCols.value || 1 }, h("div", { class: "s-empty" }, "暂无数据"))))
    ]))
  },
})
</script>

<style scoped>
/* .s-table 基础样式在 style.css（与 STable 共用） */
.s-data-table { width: 100%; overflow: auto; }
.s-table.resizable { table-layout: fixed; }
.s-table-heading { display: flex; min-width: 0; flex-direction: column; align-items: stretch; gap: 5px; }
.s-table th:has(.s-table-resize) { position: sticky; }
.s-table-resize { position: absolute; top: 0; right: -4px; bottom: 0; z-index: 2; width: 8px; cursor: col-resize; touch-action: none; }
.s-table th:last-child .s-table-resize { right: 0; }
.s-table-resize::after { position: absolute; top: 9px; bottom: 9px; left: 3px; width: 2px; border-radius: 2px; background: color-mix(in srgb, var(--sui-primary) 72%, transparent); content: ""; }
.s-table-resize:hover::after, .s-table-resize:focus-visible::after { top: 5px; bottom: 5px; left: 2px; width: 4px; background: var(--sui-primary); box-shadow: 0 0 8px color-mix(in srgb, var(--sui-primary) 55%, transparent); }
.s-table-resize:focus-visible { outline: 0; }
.s-table-heading > span, .s-table-sort { min-width: 0; min-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-table-sort { width: 100%; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; font-weight: 600; text-align: left; }
.s-table-sort.active { color: var(--sui-primary); }
.s-table-filter { width: 100%; min-width: 56px; max-width: 100%; height: 26px; padding: 2px 6px; border: 1px solid var(--sui-border-strong); border-radius: var(--sui-radius-sm); background: var(--sui-bg); color: var(--sui-fg); cursor: pointer; font-size: 12px; }
.s-table-cell--ellipsis { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-table-expand-th { width: 32px; padding: 8px 4px; }
.s-table-expand-cell { width: 32px; padding: 6px 4px; text-align: center; user-select: none; }
.s-table-expand-button { display: inline-grid; width: 24px; height: 24px; padding: 0; place-items: center; border: 0; border-radius: var(--sui-radius-sm); background: transparent; color: var(--sui-fg-muted); cursor: pointer; }
.s-table-expand-button:hover { background: var(--sui-bg-hover); color: var(--sui-fg); }
.s-table-expand-button:focus-visible { outline: 2px solid var(--sui-primary); outline-offset: 1px; }
.s-table-expand-icon { display: inline-block; font-size: 10px; line-height: 1; }
.s-table-row--expandable { cursor: pointer; }
.s-table-row--expanded > td { background: var(--sui-bg-soft); }
.s-table-expanded-row > td { background: var(--sui-bg-soft); border-bottom: 1px solid var(--sui-border); }
.s-table-expanded-spacer { width: 32px; padding: 0; }
.s-table-expanded-cell { padding: 8px 12px; }
</style>
