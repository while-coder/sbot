<script lang="ts">
import { defineComponent } from "vue"

// 仅用于在 STabs 的默认槽里声明一个不渲染面板的页签
export default defineComponent({
  name: "STab",
  props: { name: null, tab: [String, Number] },
  setup: () => () => null,
})
</script>
