import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import type { HubSkillResult, SkillHubProvider } from './types';

export interface Bundle {
  id: string;
  name: string;
  content: string;
  files: Record<string, string>;
}

export function normalizeBundle(payload: any): Bundle {
  const data = (payload?.skill && typeof payload.skill === 'object') ? payload.skill : payload;

  let content: string = data.content ?? data.skill_md ?? data.skillMd ?? '';
  const rawFiles: Record<string, string> = data.files ?? {};

  if (!content && typeof rawFiles['SKILL.md'] === 'string') content = rawFiles['SKILL.md'];
  if (!content) throw new Error('Hub bundle missing SKILL.md content');

  let name: string = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    const nameMatch = match?.[1].match(/^name\s*:\s*(.+)$/m);
    name = nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';
  }
  if (!name) throw new Error('Hub bundle missing skill name');

  const files: Record<string, string> = {};
  for (const [rel, fileContent] of Object.entries(rawFiles)) {
    if (rel === 'SKILL.md') continue;
    if (typeof fileContent === 'string') files[rel] = fileContent;
  }

  return { id: '', name, content, files };
}

export function writeSkillToDisk(bundle: Bundle, targetDir: string, overwrite: boolean): string {
  const dirName = bundle.id || bundle.name;
  const skillDir = path.join(targetDir, dirName);

  if (fs.existsSync(skillDir)) {
    if (!overwrite) {
      throw new Error(`Skill '${dirName}' already exists at ${skillDir}. Use overwrite: true to replace it.`);
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

export interface ZipInstallResult {
  name: string;
  path: string;
}

function parseSkillName(content: string): string {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const nameMatch = match?.[1].match(/^name\s*:\s*(.+)$/m);
  return nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

export function installSkillFromZip(buf: Buffer, targetDir: string, overwrite: boolean): ZipInstallResult[] {
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();

  const skillMdEntries = entries.filter(e => !e.isDirectory && e.entryName.endsWith('SKILL.md'));
  if (!skillMdEntries.length) throw new Error('zip 中未找到 SKILL.md');

  // Sort by depth so shallower skills are processed first
  skillMdEntries.sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length);

  // Each SKILL.md defines a skill rooted at its parent directory
  const skillRoots = skillMdEntries.map(e => {
    const idx = e.entryName.lastIndexOf('SKILL.md');
    return e.entryName.slice(0, idx); // '' for root, or 'some/path/'
  });

  const results: ZipInstallResult[] = [];

  for (let i = 0; i < skillMdEntries.length; i++) {
    const prefix = skillRoots[i];
    const dirName = prefix ? prefix.replace(/\/$/, '').split('/').pop()! : '';
    const name = dirName || parseSkillName(skillMdEntries[i].getData().toString('utf-8'));
    if (!name) throw new Error(`无法确定 skill 名称: ${skillMdEntries[i].entryName}`);

    // Collect files under this prefix but not under a deeper skill root
    const skillEntries = entries.filter(e => {
      if (e.isDirectory) return false;
      if (!e.entryName.startsWith(prefix)) return false;
      const rel = e.entryName.slice(prefix.length);
      if (!rel) return false;
      // Exclude files that belong to a nested skill
      return !skillRoots.some((other, j) => j !== i && other.startsWith(prefix) && other !== prefix && e.entryName.startsWith(other));
    });

    const skillDir = path.join(targetDir, name);
    if (fs.existsSync(skillDir)) {
      if (!overwrite) throw new Error(`Skill '${name}' 已存在，启用覆盖以替换`);
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
    fs.mkdirSync(skillDir, { recursive: true });

    for (const entry of skillEntries) {
      const rel = entry.entryName.slice(prefix.length);
      const fullPath = path.join(skillDir, rel);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, entry.getData());
    }

    results.push({ name, path: skillDir });
  }

  return results;
}

export function mapToHubResults(items: any[], provider: SkillHubProvider): HubSkillResult[] {
  return items
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      id: String(item.slug ?? item.name ?? ''),
      name: String(item.name ?? item.displayName ?? item.slug ?? ''),
      description: String(item.description ?? item.summary ?? ''),
      version: String(item.version ?? ''),
      sourceUrl: String(item.url ?? ''),
      provider,
      ...(item.score != null ? { score: Number(item.score) } : {}),
      ...(item.updatedAt != null ? { updatedAt: Number(item.updatedAt) } : {}),
      ...(item.installs != null ? { installs: Number(item.installs) } : {}),
    }))
    .filter(r => r.id);
}
