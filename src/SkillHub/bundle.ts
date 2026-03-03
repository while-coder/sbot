import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import type { HubSkillResult } from './types';

export interface Bundle {
  name: string;
  content: string;
  files: Record<string, string>;
}

export function extractNameFromFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return '';
  const nameMatch = match[1].match(/^name\s*:\s*(.+)$/m);
  return nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

export function normalizeBundle(payload: any): Bundle {
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

export function writeSkillToDisk(bundle: Bundle, targetDir: string, overwrite: boolean): string {
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

export function mapToHubResults(items: any[]): HubSkillResult[] {
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

export function requireHttpUrl(bundleUrl: string): void {
  try {
    const u = new URL(bundleUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('bundleUrl must be a valid http(s) URL');
  }
}
