<script lang="ts">
import { defineComponent, Teleport, h, nextTick, onBeforeUnmount, ref, watch, type PropType } from "vue"
import type { SelectOption } from "./SSelect.vue"

export default defineComponent({
  name: "SDropdown",
  inheritAttrs: false,
  emits: ["select"],
  props: { show: Boolean, x: Number, y: Number, options: { type: Array as PropType<SelectOption[]>, default: () => [] }, onClickoutside: Function as PropType<() => void> },
  setup(props, { emit }) {
    const root = ref<HTMLElement | null>(null)
    const outside = (event: PointerEvent) => { if (props.show && root.value && !root.value.contains(event.target as Node)) props.onClickoutside?.() }
    watch(() => props.show, show => { if (show) nextTick(() => document.addEventListener("pointerdown", outside)); else document.removeEventListener("pointerdown", outside) }, { immediate: true })
    onBeforeUnmount(() => document.removeEventListener("pointerdown", outside))
    const renderOptions = (options: SelectOption[]) => options.filter(option => option.show !== false).map(option => option.divider ? h("div", { class: "s-dropdown-divider", role: "separator" }) : option.children?.length ? h("div", { class: "s-dropdown-group" }, [h("div", { class: "s-dropdown-label" }, typeof option.label === "function" ? option.label() as any : (option.label ?? "")), h("div", { class: "s-dropdown-children" }, renderOptions(option.children))]) : h("button", { type: "button", role: "menuitem", class: "s-dropdown-item", disabled: option.disabled, onClick: () => emit("select", option.key ?? option.value) }, typeof option.label === "function" ? option.label() as any : (option.label ?? "")))
    return () => props.show ? h(Teleport, { to: "body" }, h("div", { ref: root, role: "menu", class: "s-dropdown", style: { left: `${props.x ?? 0}px`, top: `${props.y ?? 0}px` } }, renderOptions(props.options))) : null
  },
})
</script>

<style scoped>
.s-dropdown { position: fixed; z-index: var(--sui-z-dropdown); min-width: 150px; padding: 5px; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); background: var(--sui-bg); box-shadow: var(--sui-shadow-lg); }
.s-dropdown-item { display: flex; width: 100%; padding: 7px 9px; border: 0; border-radius: 4px; background: transparent; color: var(--sui-fg-secondary); cursor: pointer; text-align: left; }
.s-dropdown-item:hover { background: var(--sui-bg-hover); }
.s-dropdown-label { padding: 5px 9px; color: var(--sui-fg-muted); font-size: 11px; }
.s-dropdown-children { padding-left: 4px; }
.s-dropdown-divider { height: 1px; margin: 4px 8px; background: var(--sui-border); }
</style>
