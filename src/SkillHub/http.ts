import axios from 'axios';
import { URLSearchParams } from 'url';

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const HTTP_TIMEOUT = 15000;
const HTTP_RETRIES = 3;
const BACKOFF_BASE = 800;
const BACKOFF_CAP = 6000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeBackoff(attempt: number): number {
  return Math.min(BACKOFF_CAP, BACKOFF_BASE * Math.pow(2, Math.max(0, attempt - 1)));
}

async function httpGet(urlStr: string, params?: Record<string, string>, accept = 'application/json'): Promise<string> {
  const fullUrl = params && Object.keys(params).length > 0
    ? `${urlStr}?${new URLSearchParams(params).toString()}`
    : urlStr;

  let lastError: any;
  for (let attempt = 1; attempt <= HTTP_RETRIES + 1; attempt++) {
    try {
      const res = await axios.get<string>(fullUrl, {
        timeout: HTTP_TIMEOUT,
        headers: { Accept: accept, 'User-Agent': 'sbot-skills-hub/1.0' },
        responseType: 'text',
        transformResponse: d => d,
      });
      return res.data;
    } catch (err: any) {
      lastError = err;
      const status: number = err.response?.status ?? 0;
      if (attempt <= HTTP_RETRIES && (RETRYABLE_STATUS.has(status) || status === 0)) {
        await sleep(computeBackoff(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export async function httpGetJson<T = any>(urlStr: string, params?: Record<string, string>): Promise<T> {
  return JSON.parse(await httpGet(urlStr, params, 'application/json')) as T;
}

export async function httpGetText(urlStr: string, params?: Record<string, string>): Promise<string> {
  return httpGet(urlStr, params, 'text/plain, text/markdown, */*');
}
