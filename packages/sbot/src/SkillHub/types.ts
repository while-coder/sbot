import axios from 'axios';
import { URLSearchParams } from 'url';

// ── Public Types ───────────────────────────────────────────────

export enum SkillHubProvider {
  Clawhub = 'clawhub',
  SkillsSh = 'skills.sh',
}

export interface HubSkillResult {
  id: string;
  name: string;
  description: string;
  version: string;
  sourceUrl: string;
  provider: SkillHubProvider;
}

export interface HubInstallResult {
  /** Hub ID（来自 HubSkillResult.id） */
  id: string;
  /** Skill 名称（来自 SKILL.md frontmatter） */
  name: string;
  /** 写入磁盘后的 skill 目录绝对路径 */
  path: string;
  /** 实际来源 URL */
  sourceUrl: string;
}

export interface InstallSkillOptions {
  /** 版本号（默认取最新版） */
  version?: string;
  /** 是否覆盖已存在的同名 skill 目录（默认 false） */
  overwrite?: boolean;
}

export interface ISkillHubService {
  /**
   * 搜索可用的 Skills
   * @param query  搜索关键词
   * @param limit  最多返回条数（默认 20）
   */
  searchSkills(query: string, limit?: number): Promise<HubSkillResult[]>;

  /**
   * 从 URL 安装 Skill 到本地目录
   * @param bundleUrl  Skill 来源 URL
   * @param targetDir  安装目标父目录
   * @param options    可选配置（version / overwrite）
   */
  installSkill(skill: HubSkillResult, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult>;

  /**
   * 从 URL 直接安装 Skill（无需事先搜索）
   * @param url       Skill 来源 URL（各 provider 自行解析）
   * @param targetDir 安装目标父目录
   * @param options   可选配置（version / overwrite）
   */
  installSkillWithUrl(url: string, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult>;
}

// ── HTTP Utilities ─────────────────────────────────────────────

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

export function requireHttpUrl(bundleUrl: string): void {
  try {
    const u = new URL(bundleUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('bundleUrl must be a valid http(s) URL');
  }
}
