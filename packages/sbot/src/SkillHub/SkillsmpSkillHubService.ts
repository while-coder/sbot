// import { URL } from 'url';
// import { httpGetJson, httpGetText } from './types';
// import { normalizeBundle, writeSkillToDisk, type Bundle } from './bundle';
// import { SkillHubProvider } from './types';
// import type { ISkillHubService, HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

// const BASE_URL = 'https://skillsmp.com';
// const GITHUB_RAW = 'https://raw.githubusercontent.com';

// /**
//  * skillsmp.com 实现
//  *
//  * 搜索 API：`https://skillsmp.com/api/v1/search?q=...&limit=...`
//  * skill.id 格式：`{owner}-{repo}-{skill}-skill-md`（slug）
//  * 安装：解析 slug → GitHub owner/repo/skillHint → 拉取 SKILL.md
//  */
// export class SkillsmpSkillHubService implements ISkillHubService {
//   async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
//     const data = await httpGetJson<any>(`${BASE_URL}/api/v1/search`, { q: query, limit: String(limit) });

//     let items: any[] = [];
//     if (Array.isArray(data)) {
//       items = data;
//     } else if (data && typeof data === 'object') {
//       for (const key of ['items', 'skills', 'results', 'data']) {
//         if (Array.isArray(data[key])) { items = data[key]; break; }
//       }
//     }

//     return items
//       .filter(item => item && (item.slug || item.name))
//       .map(item => {
//         const slug = String(item.slug ?? item.id ?? item.name ?? '');
//         return {
//           id: slug,
//           name: String(item.name ?? item.displayName ?? slug),
//           description: String(item.description ?? item.summary ?? ''),
//           version: String(item.version ?? ''),
//           sourceUrl: `${BASE_URL}/skills/${slug}`,
//           provider: SkillHubProvider.SkillsMp,
//         };
//       })
//       .filter(r => r.id);
//   }

//   /** 从 HubSkillResult 安装（委托给 installSkillWithUrl） */
//   async installSkill(skill: HubSkillResult, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult> {
//     return this.installSkillWithUrl(skill.sourceUrl, targetDir, options);
//   }

//   /** 主要安装入口：直接从 URL 安装 */
//   async installSkillWithUrl(url: string, targetDir: string, options: InstallSkillOptions = {}): Promise<HubInstallResult> {
//     const u = new URL(url);
//     const parts = u.pathname.split('/').filter(Boolean);
//     const skillsIdx = parts.indexOf('skills');
//     const slug = skillsIdx >= 0 && parts[skillsIdx + 1] ? parts[skillsIdx + 1] : parts[parts.length - 1] ?? '';
//     if (!slug) throw new Error(`无法从 skillsmp URL 中提取 slug: ${url}`);

//     const { version = '', overwrite = false } = options;
//     const { bundle, sourceUrl } = await this._fetch(slug, version);
//     bundle.id = slug;
//     const skillPath = writeSkillToDisk(bundle, targetDir, overwrite);
//     return { id: slug, name: bundle.name, path: skillPath, sourceUrl };
//   }

//   private async _fetch(id: string, version: string): Promise<{ bundle: Bundle; sourceUrl: string }> {
//     let slug = id.endsWith('-skill-md') ? id.slice(0, -'-skill-md'.length) : id;

//     const branches = version ? [version] : ['main', 'master'];

//     for (const { owner, repo, skillHint } of this._parseCandidates(slug)) {
//       const sourceUrl = `https://github.com/${owner}/${repo}`;
//       const roots = skillHint ? [`skills/${skillHint}`, skillHint] : [''];

//       for (const branch of branches) {
//         for (const root of roots) {
//           const url = root
//             ? `${GITHUB_RAW}/${owner}/${repo}/${branch}/${root}/SKILL.md`
//             : `${GITHUB_RAW}/${owner}/${repo}/${branch}/SKILL.md`;
//           try {
//             const content = await httpGetText(url);
//             const name = skillHint.split('-').pop() || repo;
//             return { bundle: normalizeBundle({ name, files: { 'SKILL.md': content } }), sourceUrl };
//           } catch { /* try next combination */ }
//         }
//       }
//     }

//     throw new Error(`无法在 skillsmp skill 中找到 SKILL.md：${id}`);
//   }

//   /**
//    * 将 slug 解析为所有可能的 (owner, repo, skillHint) 组合，
//    * 从最长 repo 名称到最短枚举（优先匹配更精确的 repo）。
//    *
//    * 示例：`openclaw-openclaw-skills-himalaya`
//    *   → tokens = [openclaw, openclaw, skills, himalaya]
//    *   → owner = openclaw, tail = [openclaw, skills, himalaya]
//    *   → 候选: repo=openclaw-skills-himalaya / hint=""
//    *          repo=openclaw-skills / hint=himalaya
//    *          repo=openclaw / hint=skills-himalaya
//    */
//   private _parseCandidates(slug: string): Array<{ owner: string; repo: string; skillHint: string }> {
//     const tokens = slug.split('-').filter(Boolean);
//     if (tokens.length < 2) return [];

//     const owner = tokens[0];
//     const tail = tokens.slice(1);
//     const maxSplit = Math.min(tail.length, 6);
//     const results: Array<{ owner: string; repo: string; skillHint: string }> = [];

//     for (let i = maxSplit; i >= 1; i--) {
//       results.push({
//         owner,
//         repo: tail.slice(0, i).join('-'),
//         skillHint: tail.slice(i).join('-'),
//       });
//     }
//     return results;
//   }
// }
