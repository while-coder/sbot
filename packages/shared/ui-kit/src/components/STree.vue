<script lang="ts">
import { defineComponent, h, nextTick, ref, type PropType, type VNode } from "vue"

export interface TreeOption {
  key: string | number
  label?: string
  children?: TreeOption[]
  [key: string]: unknown
}

export default defineComponent({
  name: "STree",
  inheritAttrs: false,
  emits: ["update:expandedKeys", "update:selectedKeys"],
  props: {
    data: { type: Array as PropType<TreeOption[]>, default: () => [] },
    pattern: String,
    filter: Function as PropType<(pattern: string, node: TreeOption) => boolean>,
    renderLabel: Function as PropType<(info: { option: TreeOption }) => unknown>,
    selectedKeys: { type: Array as PropType<(string | number)[]>, default: () => [] },
    expandedKeys: { type: Array as PropType<(string | number)[]>, default: () => [] },
  },
  setup(props, { attrs, emit, expose }) {
    type VisibleNode = { node: TreeOption; parentKey?: string | number }
    const labels = new Map<string | number, HTMLElement>()
    const containsMatch = (node: TreeOption): boolean => !props.pattern || (props.filter?.(props.pattern, node) ?? String(node.label ?? "").toLowerCase().includes(props.pattern.toLowerCase())) || Boolean(node.children?.some(containsMatch))
    const isExpanded = (node: TreeOption) => Boolean(props.pattern) || props.expandedKeys.includes(node.key)
    const toggle = (key: string | number) => emit("update:expandedKeys", props.expandedKeys.includes(key) ? props.expandedKeys.filter(item => item !== key) : [...props.expandedKeys, key])
    //定位/Ping：外部通过 ref 调用 scrollTo 把节点滚到可见，ping 给节点短暂高亮闪烁（类似 Unity Hierarchy 的 Ping）
    const pingKey = ref<string | number | null>(null)
    let pingTimer: ReturnType<typeof setTimeout> | null = null
    const scrollTo = (key: string | number) => {
      nextTick(() => labels.get(key)?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }))
    }
    const ping = (key: string | number) => {
      pingKey.value = key
      if (pingTimer) clearTimeout(pingTimer)
      pingTimer = setTimeout(() => { pingKey.value = null; pingTimer = null }, 1600)
    }
    expose({ scrollTo, ping })
    const visibleNodes = () => {
      const result: VisibleNode[] = []
      const append = (nodes: TreeOption[], parentKey?: string | number) => nodes.forEach(node => {
        if (!containsMatch(node)) return
        result.push({ node, parentKey })
        if (node.children?.length && isExpanded(node)) append(node.children, node.key)
      })
      append(props.data)
      return result
    }
    const focusNode = (key: string | number) => nextTick(() => labels.get(key)?.focus())
    const selectNode = (node: TreeOption) => emit("update:selectedKeys", [node.key], [node])
    const onKeydown = (event: KeyboardEvent, node: TreeOption) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const visible = visibleNodes()
      const index = visible.findIndex(item => item.node.key === node.key)
      if (index < 0) return
      let focusKey: string | number | undefined
      if (event.key === "ArrowUp") focusKey = visible[index - 1]?.node.key
      else if (event.key === "ArrowDown") focusKey = visible[index + 1]?.node.key
      else if (event.key === "Home") focusKey = visible[0]?.node.key
      else if (event.key === "End") focusKey = visible[visible.length - 1]?.node.key
      else if (event.key === "ArrowLeft") {
        if (!props.pattern && node.children?.length && isExpanded(node)) toggle(node.key)
        else focusKey = visible[index].parentKey
      } else if (event.key === "ArrowRight") {
        if (node.children?.length && !isExpanded(node)) toggle(node.key)
        else if (node.children?.length) focusKey = node.children.find(containsMatch)?.key
      } else if (event.key === "Enter" || event.key === " ") selectNode(node)
      else return
      event.preventDefault()
      if (focusKey != null) focusNode(focusKey)
    }
    const renderNode = (node: TreeOption, tabKey?: string | number): VNode | null => {
      if (!containsMatch(node)) return null
      const hasChildren = Boolean(node.children?.length)
      const expanded = isExpanded(node)
      const selected = props.selectedKeys.includes(node.key)
      return h("li", { class: "s-tree-node", key: node.key, role: "treeitem", "aria-expanded": hasChildren ? expanded : undefined, "aria-selected": selected }, [h("div", { class: ["s-tree-row", { selected, ping: pingKey.value === node.key }], onKeydown: (event: KeyboardEvent) => onKeydown(event, node) }, [hasChildren ? h("button", { type: "button", tabindex: -1, class: "s-tree-toggle", "aria-label": expanded ? "折叠" : "展开", onClick: () => toggle(node.key) }, expanded ? "▾" : "▸") : h("span", { class: "s-tree-spacer" }), h("button", { type: "button", tabindex: node.key === tabKey ? 0 : -1, ref: (element: any) => element ? labels.set(node.key, element) : labels.delete(node.key), class: "s-tree-label", onClick: () => selectNode(node) }, props.renderLabel?.({ option: node }) as any ?? node.label ?? String(node.key))]), hasChildren && expanded ? h("ul", { class: "s-tree-children", role: "group" }, node.children?.map(child => renderNode(child, tabKey))) : null])
    }
    return () => {
      const visible = visibleNodes()
      const tabKey = visible.find(item => props.selectedKeys.includes(item.node.key))?.node.key ?? visible[0]?.node.key
      return h("div", { ...attrs, class: ["s-tree", attrs.class], role: "tree" }, h("ul", { class: "s-tree-root", role: "group" }, props.data.map(node => renderNode(node, tabKey))))
    }
  },
})
</script>

<style scoped>
.s-tree { min-height: 0; overflow: auto; color: var(--sui-fg-secondary); font-size: 13px; }
.s-tree-root, .s-tree-children { margin: 0; padding: 0; list-style: none; }
.s-tree-children { padding-left: 16px; }
.s-tree-row { display: flex; min-height: 26px; align-items: center; border-radius: 4px; }
.s-tree-row:hover { background: var(--sui-bg-hover); }
.s-tree-row.selected { background: color-mix(in srgb, var(--sui-primary) 16%, transparent); }
.s-tree-toggle, .s-tree-label { border: 0; background: transparent; color: inherit; cursor: pointer; }
.s-tree-toggle { width: 24px; }
.s-tree-spacer { width: 24px; }
.s-tree-label { min-width: 0; flex: 1; padding: 4px; text-align: left; }
.s-tree-row.ping { animation: s-tree-ping 1.6s ease-out; }
@keyframes s-tree-ping { 0% { background: color-mix(in srgb, var(--sui-primary) 45%, transparent); box-shadow: 0 0 0 1px var(--sui-primary); } 35% { background: color-mix(in srgb, var(--sui-primary) 16%, transparent); box-shadow: none; } 55% { background: color-mix(in srgb, var(--sui-primary) 30%, transparent); } 100% { background: transparent; } }
</style>
