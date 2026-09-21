import { backend } from './backend'

/** sbot 统一包装的错误响应：{ success: false, message } */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!backend.baseUrl) throw new ApiError('sbot 服务尚未就绪', 0)
  const resp = await fetch(`${backend.baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json: any
  try {
    json = await resp.json()
  } catch {
    if (!resp.ok) throw new ApiError(`请求失败（${resp.status}）`, resp.status)
    return null as T
  }
  if (json && typeof json === 'object' && 'success' in json) {
    if (!json.success) {
      throw new ApiError(String(json.message ?? '请求失败'), resp.status)
    }
    return json.data as T
  }
  return json as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
}
