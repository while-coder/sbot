<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import Layout from '@/layouts/Layout.vue'
import Toast from '@/components/Toast.vue'

// Fix: prevent modal from closing when user drags from inside the modal to outside.
// When mousedown happens inside the modal-box and mouseup happens on the overlay,
// the browser synthesizes a click on the overlay, triggering @click.self to close.
// We track mousedown target and block any overlay click that didn't originate there.

let mousedownTarget: EventTarget | null = null

function onMousedown(e: MouseEvent) {
  mousedownTarget = e.target
}

function onClickCapture(e: MouseEvent) {
  const target = e.target as Element
  if (target.classList.contains('modal-overlay') && mousedownTarget !== target) {
    e.stopPropagation()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onMousedown)
  document.addEventListener('click', onClickCapture, true)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onMousedown)
  document.removeEventListener('click', onClickCapture, true)
})
</script>

<template>
  <Layout />
  <Toast />
</template>
