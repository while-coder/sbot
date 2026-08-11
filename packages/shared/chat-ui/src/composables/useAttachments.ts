import { ref } from 'vue'
import type { Attachment } from '../types'

const TEXT_MIME_RE = /^(text\/|application\/(json|xml|javascript|xhtml\+xml)$)/

const isTextMime = (type: string) => TEXT_MIME_RE.test(type)
const isImageMime = (type: string) => type.startsWith('image/')

function readFile(file: File): Promise<Attachment> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    if (isTextMime(file.type)) {
      reader.onload = () => resolve({ name: file.name, type: file.type, content: reader.result as string })
      reader.readAsText(file)
    } else {
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result as string })
      reader.readAsDataURL(file)
    }
  })
}

/**
 * Shared attachment state for chat input bars. Skips duplicate filenames and reads files lazily.
 */
export function useAttachments() {
  const attachments = ref<Attachment[]>([])

  async function add(files: File[]) {
    for (const file of files) {
      if (attachments.value.some(a => a.name === file.name)) continue
      attachments.value.push(await readFile(file))
    }
  }

  function remove(idx: number) {
    attachments.value.splice(idx, 1)
  }

  /** Pop all attachments (and reset the array). */
  function drain(): Attachment[] {
    return attachments.value.splice(0)
  }

  return { attachments, add, remove, drain, isImageMime }
}
