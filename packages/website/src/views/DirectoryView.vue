<script setup lang="ts">
</script>

<template>
  <div style="height:100%;display:flex;overflow:hidden">

    <!-- Left sidebar -->
    <div style="width:180px;border-right:1px solid #e8e6e3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
      <div style="padding:6px 8px;border-bottom:1px solid #e8e6e3;flex-shrink:0">
        <button class="btn-outline btn-sm" style="width:100%">+ 新建</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:4px">
        <div style="text-align:center;color:#94a3b8;padding:20px 8px;font-size:12px">
          暂无内容
        </div>
      </div>
    </div>

    <!-- Right panel -->
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">

      <!-- Toolbar -->
      <div class="page-toolbar">
        <span class="page-toolbar-title">目录</span>
      </div>

      <!-- Content area -->
      <div class="page-content">
        <div style="text-align:center;color:#94a3b8;padding:60px;font-size:13px">
          暂无内容
        </div>
      </div>

    </div>
  </div>
</template>
