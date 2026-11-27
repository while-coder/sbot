import { computed, ref } from 'vue'
import type { Attachment } from '../types'

const isImageMime = (type: string) => type.startsWith('image/')

function readFile(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reader.onabort = reject
    reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result as string })
    reader.readAsDataURL(file)
  })
}

/**
 * Reads attachments in the order they were added, across picker, drop and paste events.
 */
export function useAttachments() {
  const attachments = ref<Attachment[]>([])
  const failedFiles = ref<string[]>([])
  const pendingBatches = ref(0)
  const isReading = computed(() => pendingBatches.value > 0)
  let queue = Promise.resolve()

  async function add(files: File[]) {
    if (files.length === 0) return
    if (!isReading.value) failedFiles.value = []
    pendingBatches.value++
    queue = queue.then(async () => {
      try {
        for (const file of files) {
          if (!isImageMime(file.type) && attachments.value.some(a => !isImageMime(a.type) && a.name === file.name)) continue
          try {
            attachments.value.push(await readFile(file))
          } catch {
            failedFiles.value.push(file.name)
          }
        }
      } finally {
        pendingBatches.value--
      }
    })
    await queue
  }

  function remove(idx: number) {
    attachments.value.splice(idx, 1)
  }

  /** Pop all attachments (and reset the array). */
  function drain(): Attachment[] {
    failedFiles.value = []
    return attachments.value.splice(0)
  }

  return { attachments, add, remove, drain, isImageMime, isReading, failedFiles }
}
