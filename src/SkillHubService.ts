import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL, URLSearchParams } from 'url';

// ── Types ──────────────────────────────────────────────────────

export interface HubSkillResult {
  slug: string;
  name: string;
  description: string;
  version: string;
  sourceUrl: string;
}

export interface HubInstallResult {
  /** Skill 名称（来自 SKILL.md frontmatter） */
  name: string;
  /** 写入磁盘后的 skill 目录绝对路径 */
  path: string;
  /** 实际来源仓库 URL */
  sourceUrl: string;
}

export interface InstallSkillOptions {
  /** 版本号或分支名（默认取最新版） */
  version?: string;
  /** 是否覆盖已存在的同名 skill 目录（默认 false） */
  overwrite?: boolean;
}

// ── HTTP ───────────────────────────────────────────────────────

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const HTTP_TIMEOUT = Number(process.env.SKILLS_HUB_HTTP_TIMEOUT ?? 15000);
const HTTP_RETRIES = Number(process.env.SKILLS_HUB_HTTP_RETRIES ?? 3);
const BACKOFF_BASE = 800;
const BACKOFF_CAP = 6000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeBackoff(attempt: number): number {
  return Math.min(BACKOFF_CAP, BACKOFF_BASE * Math.pow(2, Math.max(0, attempt - 1)));
}

function httpGetRaw(urlStr: string, accept: string, redirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error(`Too many redirects: ${urlStr}`));
    let parsed: URL;
    try { parsed = new URL(urlStr); } catch (e) { return reject(e); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = {
      'Accept': accept,
      'User-Agent': 'scorpio-skills-hub/1.0',
    };
    if (parsed.hostname === 'api.github.com') {
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const req = lib.get(urlStr, { headers, timeout: HTTP_TIMEOUT }, res => {
      const { statusCode, headers: resHeaders } = res;

      // Follow redirects
      if (statusCode && statusCode >= 300 && statusCode < 400 && resHeaders.location) {
        res.resume();
        httpGetRaw(resHeaders.location, accept, redirects - 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode && statusCode >= 400) {
        res.resume();
        const err: any = new Error(`HTTP ${statusCode}: ${urlStr}`);
        err.statusCode = statusCode;
        // Surface GitHub rate-limit message for clarity
        if (statusCode === 403 && parsed.hostname === 'api.github.com') {
          err.message = `GitHub API rate limit exceeded. Set GITHUB_TOKEN (or GH_TOKEN) to increase the limit.`;
        }
        return reject(err);
      }

      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });

    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timeout: ${urlStr}`)); });
    req.on('error', reject);
  });
}

async function httpGet(urlStr: string, params?: Record<string, string>, accept = 'application/json'): Promise<string> {
  let fullUrl = urlStr;
  if (params && Object.keys(params).length > 0) {
    fullUrl = `${urlStr}?${new URLSearchParams(params).toString()}`;
  }

  let lastError: any;
  for (let attempt = 1; attempt <= HTTP_RETRIES + 1; attempt++) {
    try {
      return await httpGetRaw(fullUrl, accept);
    } catch (err: any) {
      lastError = err;
      const status: number = err.statusCode ?? 0;
      if (attempt <= HTTP_RETRIES && (RETRYABLE_STATUS.has(status) || status === 0)) {
        await sleep(computeBackoff(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function httpGetJson<T = any>(urlStr: string, params?: Record<string, string>): Promise<T> {
  return JSON.parse(await httpGet(urlStr, params, 'application/json')) as T;
}

async function httpGetText(urlStr: string, params?: Record<string, string>): Promise<string> {
  return httpGet(urlStr, params, 'text/plain, text/markdown, */*');
}

// ── URL Parsers ────────────────────────────────────────────────

function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractClawhubSlug(url: string): string {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('clawhub.ai')) return '';
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  } catch {
    return '';
  }
}

interface GitHubSpec { owner: string; repo: string; branch: string; pathHint: string; }
function extractGitHubSpec(url: string): GitHubSpec | null {
  try {
    const u = new URL(url);
    if (!['github.com', 'www.github.com'].includes(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    let branch = '', pathHint = '';
    if (parts.length >= 4 && (parts[2] === 'tree' || parts[2] === 'blob')) {
      branch = parts[3];
      if (parts.length > 4) pathHint = parts.slice(4).join('/');
    } else if (parts.length > 2) {
      pathHint = parts.slice(2).join('/');
    }
    return { owner, repo, branch, pathHint };
  } catch {
    return null;
  }
}

interface SkillsShSpec { owner: string; repo: string; skill: string; }
function extractSkillsShSpec(url: string): SkillsShSpec | null {
  try {
    const u = new URL(url);
    if (!['skills.sh', 'www.skills.sh'].includes(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 3) return null;
    return { owner: parts[0], repo: parts[1], skill: parts[2] };
  } catch {
    return null;
  }
}

// ── GitHub API Helpers ─────────────────────────────────────────

function githubApiUrl(owner: string, repo: string, suffix = ''): string {
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  return suffix ? `${base}/${suffix.replace(/^\//, '')}` : base;
}

async function githubGetContentEntry(owner: string, repo: string, filePath: string, ref: string): Promise<any> {
  const params = ref ? { ref } : undefined;
  return httpGetJson<any>(githubApiUrl(owner, repo, `contents/${filePath}`), params);
}

async function githubGetDirEntries(owner: string, repo: string, dirPath: string, ref: string): Promise<any[]> {
  const params = ref ? { ref } : undefined;
  const data = await httpGetJson<any>(githubApiUrl(owner, repo, `contents/${dirPath}`), params);
  return Array.isArray(data) ? data : [];
}

async function githubListSkillMdRoots(owner: string, repo: string, ref: string): Promise<string[]> {
  const data = await httpGetJson<any>(
    githubApiUrl(owner, repo, `git/trees/${ref}`),
    { recursive: '1' },
  );
  const tree: any[] = data?.tree ?? [];
  const roots: string[] = [];
  for (const item of tree) {
    const p: string = item?.path ?? '';
    if (p === 'SKILL.md') roots.push('');
    else if (p.endsWith('/SKILL.md')) roots.push(p.slice(0, -'/SKILL.md'.length));
  }
  return [...new Set(roots)];
}

function githubReadFile(entry: any): Promise<string> {
  if (typeof entry.download_url === 'string' && entry.download_url)
    return httpGetText(entry.download_url);
  if (typeof entry.content === 'string' && entry.content)
    return Promise.resolve(Buffer.from(entry.content.replace(/\n/g, ''), 'base64').toString('utf-8'));
  return Promise.reject(new Error('Unable to read file content from GitHub entry'));
}

function joinRepoPath(root: string, leaf: string): string {
  if (!root) return leaf;
  return `${root.replace(/\/$/, '')}/${leaf.replace(/^\//, '')}`;
}

function relativeFromRoot(fullPath: string, root: string): string {
  if (!root) return fullPath.replace(/^\//, '');
  const prefix = `${root.replace(/\/$/, '')}/`;
  return fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
}

async function githubCollectSubdirFiles(
  owner: string, repo: string, ref: string, root: string, subdir: string,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const pending = [joinRepoPath(root, subdir)];
  let count = 0;

  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries: any[];
    try { entries = await githubGetDirEntries(owner, repo, dir, ref); }
    catch (err: any) { if (err.statusCode === 404) break; throw err; }

    for (const entry of entries) {
      const type: string = entry?.type ?? '';
      const entryPath: string = entry?.path ?? '';
      if (!entryPath) continue;
      if (type === 'dir') { pending.push(entryPath); continue; }
      if (type !== 'file') continue;
      const rel = relativeFromRoot(entryPath, root);
      if (!rel.startsWith('references/') && !rel.startsWith('scripts/')) continue;
      files[rel] = await githubReadFile(entry);
      if (++count >= 200) return files;
    }
  }
  return files;
}

// ── Bundle Normalization ───────────────────────────────────────

interface Bundle {
  name: string;
  content: string;                 // SKILL.md text
  files: Record<string, string>;   // relative path → content (references/, scripts/, extras)
}

function extractNameFromFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return '';
  const nameMatch = match[1].match(/^name\s*:\s*(.+)$/m);
  return nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function normalizeBundle(payload: any): Bundle {
  // Accept either { skill: {...} } wrapper or flat payload
  const data = (payload?.skill && typeof payload.skill === 'object') ? payload.skill : payload;

  let content: string = data.content ?? data.skill_md ?? data.skillMd ?? '';
  const rawFiles: Record<string, string> = data.files ?? {};

  if (!content && typeof rawFiles['SKILL.md'] === 'string') content = rawFiles['SKILL.md'];
  if (!content) throw new Error('Hub bundle missing SKILL.md content');

  let name: string = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) name = extractNameFromFrontmatter(content);
  if (!name) throw new Error('Hub bundle missing skill name');

  const files: Record<string, string> = {};
  for (const [rel, fileContent] of Object.entries(rawFiles)) {
    if (rel === 'SKILL.md') continue;
    if (typeof fileContent === 'string') files[rel] = fileContent;
  }

  return { name, content, files };
}

// ── Source Fetchers ────────────────────────────────────────────

function normalizeSkillKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function fetchFromGitHub(
  owner: string, repo: string, skillHint: string, requestedVersion: string,
): Promise<{ bundle: Bundle; sourceUrl: string }> {
  const branches = requestedVersion?.trim() ? [requestedVersion.trim()] : ['main', 'master'];

  let skillMdEntry: any = null;
  let selectedRoot = '';
  let branch = branches[0];

  // Direct path probing
  for (const candidate of branches) {
    branch = candidate;
    const roots = skillHint
      ? [joinRepoPath('skills', skillHint), skillHint, '']
      : [''];
    for (const root of roots) {
      const mdPath = joinRepoPath(root, 'SKILL.md') || 'SKILL.md';
      try {
        const entry = await githubGetContentEntry(owner, repo, mdPath, branch);
        if (entry?.type === 'file') { selectedRoot = root; skillMdEntry = entry; break; }
      } catch (err: any) { if (err.statusCode !== 404) throw err; }
    }
    if (skillMdEntry) break;
  }

  // Fuzzy match via repo tree listing
  if (!skillMdEntry) {
    const hintNorm = normalizeSkillKey(skillHint);
    for (const candidate of branches) {
      branch = candidate;
      let roots: string[];
      try { roots = await githubListSkillMdRoots(owner, repo, branch); } catch { continue; }
      for (const root of roots) {
        const leaf = root.split('/').pop() ?? root;
        const leafNorm = normalizeSkillKey(leaf);
        if (!leafNorm) continue;
        if (!hintNorm || leafNorm === hintNorm || leafNorm.includes(hintNorm) || hintNorm.includes(leafNorm)) {
          const mdPath = joinRepoPath(root, 'SKILL.md') || 'SKILL.md';
          try {
            const entry = await githubGetContentEntry(owner, repo, mdPath, branch);
            if (entry?.type === 'file') { selectedRoot = root; skillMdEntry = entry; break; }
          } catch { continue; }
        }
      }
      if (skillMdEntry) break;
    }
  }

  if (!skillMdEntry) throw new Error('Could not find SKILL.md in source repository');

  const rawFiles: Record<string, string> = { 'SKILL.md': await githubReadFile(skillMdEntry) };
  for (const subdir of ['references', 'scripts']) {
    try {
      const extra = await githubCollectSubdirFiles(owner, repo, branch, selectedRoot, subdir);
      Object.assign(rawFiles, extra);
    } catch (err: any) { if (err.statusCode !== 404) throw err; }
  }

  const skillName = skillHint.split('/').pop()?.trim() || repo;
  const bundle = normalizeBundle({ name: skillName, files: rawFiles });
  return { bundle, sourceUrl: `https://github.com/${owner}/${repo}` };
}

const hubBaseUrl = () => process.env.COPAW_SKILLS_HUB_BASE_URL ?? 'https://clawhub.ai';

async function fetchFromClawhub(slug: string, version: string): Promise<{ bundle: Bundle; sourceUrl: string }> {
  const detailUrl = `${hubBaseUrl()}/api/v1/skills/${slug}`;
  const data = await httpGetJson<any>(detailUrl);

  // Try to hydrate with per-file content if the detail response only has metadata
  const versionHint = version || data?.latestVersion?.version || data?.skill?.tags?.latest || '';
  let versionObj = data?.version;

  if (versionHint && !(versionObj?.files)) {
    try {
      const versionUrl = `${hubBaseUrl()}/api/v1/skills/${slug}/versions/${versionHint}`;
      const versionData = await httpGetJson<any>(versionUrl);
      versionObj = versionData?.version ?? versionObj;
    } catch { /* fall through to bundle fallback */ }
  }

  if (versionObj?.files && Array.isArray(versionObj.files)) {
    const fileUrl = `${hubBaseUrl()}/api/v1/skills/${slug}/file`;
    const versionStr: string = versionObj.version ?? versionHint;
    const rawFiles: Record<string, string> = {};

    for (const item of versionObj.files) {
      const filePath: string = item?.path;
      if (!filePath) continue;
      const params: Record<string, string> = { path: filePath };
      if (versionStr) params.version = versionStr;
      try { rawFiles[filePath] = await httpGetText(fileUrl, params); } catch { /* skip */ }
    }

    const skillName = data?.skill?.displayName ?? data?.skill?.slug ?? slug;
    return { bundle: normalizeBundle({ name: skillName, files: rawFiles }), sourceUrl: detailUrl };
  }

  // Fallback: treat the response itself as a bundle
  return { bundle: normalizeBundle(data), sourceUrl: detailUrl };
}

// ── Write to Disk ──────────────────────────────────────────────

function writeSkillToDisk(bundle: Bundle, targetDir: string, overwrite: boolean): string {
  const skillDir = path.join(targetDir, bundle.name);

  if (fs.existsSync(skillDir)) {
    if (!overwrite) {
      throw new Error(`Skill '${bundle.name}' already exists at ${skillDir}. Use overwrite: true to replace it.`);
    }
    fs.rmSync(skillDir, { recursive: true, force: true });
  }

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), bundle.content, 'utf-8');

  for (const [rel, content] of Object.entries(bundle.files)) {
    const fullPath = path.join(skillDir, rel);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  return skillDir;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * SkillHubService — 从远程仓库/市场安装 Skills
 *
 * 支持以下 URL 格式：
 * - **clawhub.ai**:  `https://clawhub.ai/{slug}`
 * - **GitHub**:      `https://github.com/{owner}/{repo}[/tree/{branch}/{path}]`
 * - **skills.sh**:   `https://skills.sh/{owner}/{repo}/{skill}`
 *
 * 下载的 Skill 写入 `{targetDir}/{skillName}/`，可直接通过
 * `SkillService.registerSkillsDir(targetDir)` 或
 * `refreshGlobalSkillService()` 加载。
 *
 * @example
 * ```ts
 * const result = await SkillHubService.installSkill(
 *   'https://github.com/example/my-skills/tree/main/pdf',
 *   config.getSkillsPath(),
 * );
 * refreshGlobalSkillService();
 * ```
 */
export class SkillHubService {
  /**
   * 搜索 ClawHub 上的 Skills
   *
   * @param query  搜索关键词
   * @param limit  最多返回条数（默认 20）
   */
  static async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const url = `${hubBaseUrl()}/api/v1/search`;
    const data = await httpGetJson<any>(url, { q: query, limit: String(limit) });

    let items: any[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object') {
      for (const key of ['items', 'skills', 'results', 'data']) {
        if (Array.isArray(data[key])) { items = data[key]; break; }
      }
    }

    return items
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        slug: String(item.slug ?? item.name ?? ''),
        name: String(item.name ?? item.displayName ?? item.slug ?? ''),
        description: String(item.description ?? item.summary ?? ''),
        version: String(item.version ?? ''),
        sourceUrl: String(item.url ?? ''),
      }))
      .filter(r => r.slug);
  }

  /**
   * 从 URL 安装 Skill 到本地目录
   *
   * @param bundleUrl  Skill 来源 URL
   * @param targetDir  安装目标父目录（skill 写入为其下的子目录）
   * @param options    可选配置（version / overwrite）
   * @returns          安装结果（name / path / sourceUrl）
   */
  static async installSkill(
    bundleUrl: string,
    targetDir: string,
    options: InstallSkillOptions = {},
  ): Promise<HubInstallResult> {
    if (!isHttpUrl(bundleUrl)) {
      throw new Error('bundleUrl must be a valid http(s) URL');
    }

    const { version = '', overwrite = false } = options;
    let bundle: Bundle;
    let sourceUrl: string;

    const skillsShSpec = extractSkillsShSpec(bundleUrl);
    if (skillsShSpec) {
      ({ bundle, sourceUrl } = await fetchFromGitHub(
        skillsShSpec.owner, skillsShSpec.repo, skillsShSpec.skill, version,
      ));
    } else {
      const githubSpec = extractGitHubSpec(bundleUrl);
      if (githubSpec) {
        let pathHint = githubSpec.pathHint;
        if (pathHint.endsWith('/SKILL.md')) pathHint = pathHint.slice(0, -'/SKILL.md'.length);
        if (pathHint === 'SKILL.md') pathHint = '';
        const branchHint = version || githubSpec.branch;
        ({ bundle, sourceUrl } = await fetchFromGitHub(
          githubSpec.owner, githubSpec.repo, pathHint, branchHint,
        ));
      } else {
        const clawhubSlug = extractClawhubSlug(bundleUrl);
        if (clawhubSlug) {
          ({ bundle, sourceUrl } = await fetchFromClawhub(clawhubSlug, version));
        } else {
          // Last-resort: treat as a direct JSON bundle URL
          const data = await httpGetJson<any>(bundleUrl);
          bundle = normalizeBundle(data);
          sourceUrl = bundleUrl;
        }
      }
    }

    const skillPath = writeSkillToDisk(bundle, targetDir, overwrite);
    return { name: bundle.name, path: skillPath, sourceUrl };
  }
}
