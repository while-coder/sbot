import axios from 'axios'

const http = axios.create()

export async function apiFetch(path: string, method = 'GET', body?: unknown): Promise<any> {
  try {
    console.log(`[API] ${method} ${path}`, body)
    const res = await http({ url: path, method, data: body })
    return res.data
  } catch (e: any) {
    const msg = e.response?.data?.message || e.response?.data?.error || e.message
    throw new Error(msg)
  }
}
