import { invoke } from '@tauri-apps/api/core'

export interface JavaCheck {
  available: boolean
  path: string | null
}

export interface DName {
  commonName: string
  organizationalUnit?: string
  organization?: string
  locality?: string
  state?: string
  country?: string
}

export interface GenerateInput {
  path: string
  alias: string
  storePassword: string
  keyPassword: string
  validityDays: number
  dname: DName
}

export interface GenerateResult {
  path: string
  base64: string
  fingerprint_sha256: string
  fingerprint_sha1: string
}

export async function checkJava(): Promise<JavaCheck> {
  return await invoke('keystore_check_java')
}

export async function generateKeystore(input: GenerateInput): Promise<GenerateResult> {
  return await invoke('keystore_generate', input)
}
