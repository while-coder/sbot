import { ref, watch } from 'vue'

type MessageHandler = (evt: any) => void

// 模块级单例，跨路由保活
const connected = ref(false)
let socket: WebSocket | null = null
const messageHandlers = new Set<MessageHandler>()

function getUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/chat`
}

function connect(): void {
  if (socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) return
  const ws = new WebSocket(getUrl())
  socket = ws
  ws.onopen = () => {
    connected.value = true
    console.log('[ChatSocket] 已连接')
  }
  ws.onmessage = (e: MessageEvent) => {
    let evt: any
    try { evt = JSON.parse(e.data as string) } catch { return }
    messageHandlers.forEach(h => h(evt))
  }
  ws.onclose = () => {
    if (socket === ws) { socket = null; connected.value = false }
    console.log('[ChatSocket] 断开，3 秒后重连')
    setTimeout(connect, 3000)
  }
  ws.onerror = () => { /* onclose 会在 onerror 后触发 */ }
}

function send(data: any): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(data))
  return true
}

function waitForOpen(timeout = 5000): Promise<void> {
  if (connected.value) return Promise.resolve()
  connect()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error('WebSocket 连接失败')) }, timeout)
    const stop = watch(connected, v => { if (v) { clearTimeout(timer); stop(); resolve() } })
  })
}

// 页面加载时立即建连
connect()

export function useChatSocket() {
  return {
    connected,
    send,
    waitForOpen,
    onMessage(handler: MessageHandler) { messageHandlers.add(handler) },
    offMessage(handler: MessageHandler) { messageHandlers.delete(handler) },
  }
}
