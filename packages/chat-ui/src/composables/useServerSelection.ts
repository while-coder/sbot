import { ref, shallowRef } from 'vue'
import type { Ref, ShallowRef } from 'vue'
import type { RemoteEntry } from '../types'

export const DEFAULT_SERVER_PORT = 5500

export type ServerSelectionPhase = 'server-pick' | 'chat'

export interface ServerConnectContext {
  local: boolean
}

export interface ServerSelectOptions {
  local?: boolean
}

export interface ServerSelectionAdapter<TTransport> {
  loadRemotes?: () => RemoteEntry[] | Promise<RemoteEntry[]>
  saveRemotes?: (remotes: RemoteEntry[]) => void | Promise<void>
  connect: (baseUrl: string, context: ServerConnectContext) => TTransport | Promise<TTransport>
  disconnect?: (transport: TTransport) => void
}

export interface UseServerSelectionOptions<TTransport> {
  adapter: ServerSelectionAdapter<TTransport>
  defaultPort?: number
  initialRemotes?: RemoteEntry[]
  formatConnectError?: (baseUrl: string, error: unknown) => string
}

export interface UseServerSelectionReturn<TTransport> {
  remotes: Ref<RemoteEntry[]>
  phase: Ref<ServerSelectionPhase>
  transport: ShallowRef<TTransport | null>
  currentBaseUrl: Ref<string>
  connectError: Ref<string>
  connecting: Ref<boolean>
  loadRemotes: () => Promise<void>
  selectServer: (baseUrl: string, options?: ServerSelectOptions) => Promise<void>
  switchServer: () => void
  selectLocal: () => Promise<void>
  selectRemote: (index: number) => Promise<void>
  addRemote: (name: string, host: string, port: number, secure?: boolean) => Promise<void>
  updateRemote: (index: number, patch: Partial<RemoteEntry>) => Promise<void>
  removeRemote: (index: number) => Promise<void>
}

export function localServerBaseUrl(port = DEFAULT_SERVER_PORT): string {
  return `http://localhost:${port}`
}

export function remoteToBaseUrl(remote: RemoteEntry): string {
  const proto = remote.secure ? 'https' : 'http'
  return `${proto}://${remote.host}:${remote.port}`
}

export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl)
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export function useServerSelection<TTransport>(
  options: UseServerSelectionOptions<TTransport>,
): UseServerSelectionReturn<TTransport> {
  const defaultPort = options.defaultPort ?? DEFAULT_SERVER_PORT
  const adapter = options.adapter
  const formatConnectError = options.formatConnectError ?? ((baseUrl: string) => `无法连接服务器 ${baseUrl}`)

  const remotes = ref<RemoteEntry[]>(options.initialRemotes ?? [])
  const phase = ref<ServerSelectionPhase>('server-pick')
  const transport = shallowRef<TTransport | null>(null)
  const currentBaseUrl = ref('')
  const connectError = ref('')
  const connecting = ref(false)

  async function loadRemotes() {
    if (!adapter.loadRemotes) return
    const loaded = await adapter.loadRemotes()
    remotes.value = Array.isArray(loaded) ? loaded : []
  }

  async function persistRemotes() {
    await adapter.saveRemotes?.(remotes.value)
  }

  async function selectServer(baseUrl: string, selectOptions: ServerSelectOptions = {}) {
    if (connecting.value) return
    connectError.value = ''
    connecting.value = true
    try {
      const local = selectOptions.local ?? isLocalBaseUrl(baseUrl)
      const nextTransport = await adapter.connect(baseUrl, { local })
      const previousTransport = transport.value
      if (previousTransport && previousTransport !== nextTransport) {
        adapter.disconnect?.(previousTransport)
      }
      transport.value = nextTransport
      currentBaseUrl.value = baseUrl
      phase.value = 'chat'
    } catch (error) {
      connectError.value = formatConnectError(baseUrl, error)
      phase.value = 'server-pick'
    } finally {
      connecting.value = false
    }
  }

  function switchServer() {
    if (transport.value) adapter.disconnect?.(transport.value)
    transport.value = null
    connectError.value = ''
    phase.value = 'server-pick'
  }

  async function selectLocal() {
    await selectServer(localServerBaseUrl(defaultPort), { local: true })
  }

  async function selectRemote(index: number) {
    const remote = remotes.value[index]
    if (!remote) return
    await selectServer(remoteToBaseUrl(remote))
  }

  async function addRemote(name: string, host: string, port: number, secure = false) {
    const remote: RemoteEntry = { name, host, port, secure }
    remotes.value.push(remote)
    await persistRemotes()
    await selectServer(remoteToBaseUrl(remote))
  }

  async function updateRemote(index: number, patch: Partial<RemoteEntry>) {
    const remote = remotes.value[index]
    if (!remote) return
    Object.assign(remote, patch)
    await persistRemotes()
  }

  async function removeRemote(index: number) {
    if (index < 0 || index >= remotes.value.length) return
    remotes.value.splice(index, 1)
    await persistRemotes()
  }

  return {
    remotes,
    phase,
    transport,
    currentBaseUrl,
    connectError,
    connecting,
    loadRemotes,
    selectServer,
    switchServer,
    selectLocal,
    selectRemote,
    addRemote,
    updateRemote,
    removeRemote,
  }
}
