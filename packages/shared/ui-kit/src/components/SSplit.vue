<script setup lang="ts">
import { onBeforeUnmount, ref, useAttrs, watch } from "vue"

defineOptions({ name: "SSplit", inheritAttrs: false })
const props = withDefaults(defineProps<{
  direction?: string
  size?: number
  defaultSize?: number
  min?: number
  max?: number
}>(), { direction: "horizontal", defaultSize: 0.5, min: 0.1, max: 0.9 })
const emit = defineEmits<{ "update:size": [size: number] }>()
const attrs = useAttrs()

const root = ref<HTMLElement | null>(null)
const clampSize = (value: number) => Math.max(props.min, Math.min(props.max, value))
const size = ref(clampSize(props.size ?? props.defaultSize))
let moving = false
const setSize = (value: number) => {
  size.value = clampSize(value)
  emit("update:size", size.value)
}
const move = (event: PointerEvent) => {
  if (!moving || !root.value) return
  const rect = root.value.getBoundingClientRect()
  const raw = props.direction === "vertical" ? (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width
  setSize(raw)
}
const stop = () => { moving = false; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop) }
const start = (event: PointerEvent) => { event.preventDefault(); moving = true; window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop) }
const adjust = (event: KeyboardEvent) => {
  const forward = props.direction === "vertical" ? event.key === "ArrowDown" : event.key === "ArrowRight"
  const backward = props.direction === "vertical" ? event.key === "ArrowUp" : event.key === "ArrowLeft"
  if (!forward && !backward) return
  event.preventDefault()
  setSize(size.value + (forward ? 0.02 : -0.02))
}
watch(() => props.size, value => {
  if (value != null) size.value = clampSize(value)
})
onBeforeUnmount(stop)
</script>

<template>
  <div v-bind="attrs" ref="root" :class="['s-split', `direction-${direction}`]" :style="[attrs.style, { '--s-split-size': `${size * 100}%` }]">
    <div class="s-split-pane first"><slot name="1" /></div>
    <div class="s-split-trigger" role="separator" tabindex="0"
      :aria-orientation="direction === 'vertical' ? 'horizontal' : 'vertical'"
      :aria-valuemin="Math.round(min * 100)" :aria-valuemax="Math.round(max * 100)" :aria-valuenow="Math.round(size * 100)"
      @pointerdown="start" @keydown="adjust" />
    <div class="s-split-pane second"><slot name="2" /></div>
  </div>
</template>

<style scoped>
.s-split { display: grid; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
.s-split.direction-horizontal { grid-template-columns: minmax(0, var(--s-split-size)) 5px minmax(0, 1fr); }
.s-split.direction-vertical { grid-template-rows: minmax(0, var(--s-split-size)) 5px minmax(0, 1fr); }
.s-split-pane { min-width: 0; min-height: 0; overflow: auto; }
.s-split-trigger { background: var(--sui-border); touch-action: none; }
.s-split.direction-horizontal > .s-split-trigger { cursor: col-resize; }
.s-split.direction-vertical > .s-split-trigger { cursor: row-resize; }
.s-split-trigger:hover { background: var(--sui-primary); }
</style>
