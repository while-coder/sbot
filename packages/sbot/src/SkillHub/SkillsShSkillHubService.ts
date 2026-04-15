import fs from 'fs';
import path from 'path';
import { httpGetJson, httpGetText } from './types';
import { SkillHubProvider } from './types';
import type { ISkillHubService, HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const BASE_URL = 'https://skills.sh';

/**
 * skills.sh 实现
 *
 * 搜索：skills.sh API
 * 安装：委托给 `npx skills add` CLI
 */
export class SkillsShSkillHubService implements ISkillHubService {
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const data = await httpGetJson<any>(`${BASE_URL}/api/search`, { q: query, limit: String(limit) });
    const items: any[] = Array.isArray(data?.skills) ? data.skills : [];
    return items
      .filter(item => item?.id && item?.name)
      .map(item => ({
        id: String(item.id),
        name: String(item.name),
        description: item.source ? `来自 ${item.source}` : '',
        version: '',
        sourceUrl: `${BASE_URL}/${item.id}`,
        provider: SkillHubProvider.SkillsSh,
        ...(item.installs != null ? { installs: Number(item.installs) } : {}),
      }));
  }

  async installSkill(skill: HubSkillResult, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult> {
    return this._installById(skill.id, targetDir, options);
  }

  async installSkillWithUrl(url: string, targetDir: string, options: InstallSkillOptions = {}): Promise<HubInstallResult> {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error(`URL 格式应至少包含 owner/repo，收到: ${u.pathname}`);
    const id = parts.slice(0, Math.min(parts.length, 3)).join('/');
    return this._installById(id, targetDir, options);
  }

  /**
   * 从 skills.sh 页面解析安装命令，然后委托 CLI 执行。
   * 页面中包含如 `npx skills add https://github.com/owner/repo --skill name` 的命令。
   */
  private async _installById(
    id: string,
    targetDir: string,
    options: InstallSkillOptions = {},
  ): Promise<HubInstallResult> {
    const { overwrite = false } = options;
    const log = (msg: string) => console.log(`[SkillHub] ${msg}`);

    // 从 skills.sh 页面 HTML 解析安装命令
    log(`parseInstallCommand for id="${id}"`);
    const { addArgs, skillName } = await this._parseInstallCommand(id);
    log(`parsed: addArgs=${JSON.stringify(addArgs)}, skillName=${skillName}`);

    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sbot-skills-'));
    log(`tmpDir: ${tmpDir}`);

    try {
      const args = ['skills', 'add', ...addArgs, '-y', '--copy'];
      await this._exec('npx', ['-y', ...args], tmpDir);

      // 查找安装结果: {tmpDir}/.agents/skills/{name}/SKILL.md
      const agentsSkillsDir = path.join(tmpDir, '.agents', 'skills');
      if (!fs.existsSync(agentsSkillsDir)) {
        log(`ERROR: .agents/skills dir not found in ${tmpDir}`);
        // 列出 tmpDir 内容帮助调试
        try { log(`tmpDir contents: ${fs.readdirSync(tmpDir).join(', ')}`); } catch {}
        throw new Error(`安装完成但未找到 skills 输出目录`);
      }

      const installed = fs.readdirSync(agentsSkillsDir).filter(d =>
        fs.existsSync(path.join(agentsSkillsDir, d, 'SKILL.md')),
      );
      log(`installed skills: [${installed.join(', ')}]`);

      if (installed.length === 0) {
        throw new Error(`安装完成但未找到 SKILL.md`);
      }

      const dirName = skillName
        ? installed.find(d => d === skillName) ?? installed[0]
        : installed[0];
      log(`selected: ${dirName}, copying to ${targetDir}`);

      const srcSkillDir = path.join(agentsSkillsDir, dirName);
      const destSkillDir = path.join(targetDir, dirName);

      if (fs.existsSync(destSkillDir)) {
        if (!overwrite) {
          throw new Error(`Skill '${dirName}' already exists at ${destSkillDir}. Use overwrite: true to replace it.`);
        }
        fs.rmSync(destSkillDir, { recursive: true, force: true });
      }

      this._copyDir(srcSkillDir, destSkillDir);
      log(`done: ${destSkillDir}`);

      return {
        id,
        name: dirName,
        path: destSkillDir,
        sourceUrl: `${BASE_URL}/${id}`,
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * 抓取 skills.sh/{id} 页面，解析出 `npx skills add {url} --skill {name}` 命令。
   * 返回 addArgs（传给 `skills add` 的参数）和 skillName。
   */
  private async _parseInstallCommand(id: string): Promise<{ addArgs: string[]; skillName?: string }> {
    const pageUrl = `${BASE_URL}/${id}`;
    const html = await httpGetText(pageUrl);

    // 匹配: npx skills add <source> --skill <name>
    // 或:    npx skills add <source>
    const m = html.match(/npx\s+skills\s+add\s+(https?:\/\/[^\s"'<]+)(?:\s+--skill\s+([^\s"'<]+))?/);
    if (m) {
      // GitHub URL 转 owner/repo 短格式（CLI 需要短格式才能 git clone）
      let source = m[1];
      const ghMatch = source.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
      if (ghMatch) source = ghMatch[1];
      const args = [source];
      if (m[2]) args.push('--skill', m[2]);
      return { addArgs: args, skillName: m[2] };
    }

    // fallback: 用 id 自身拆分
    const parts = id.split('/');
    if (parts.length >= 3) {
      const source = `${parts[0]}/${parts[1]}`;
      const skill = parts.slice(2).join('/');
      return { addArgs: [source, '--skill', skill], skillName: skill };
    }

    return { addArgs: [id] };
  }

  private _exec(cmd: string, args: string[], cwd: string): Promise<string> {
    console.log(`[SkillHub] exec: ${cmd} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
      const proc = require('child_process').spawn(cmd, args, {
        cwd,
        timeout: 120_000,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // 避免继承 Node debug 端口
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code: number) => {
        if (code !== 0) {
          // 清除 ANSI 码
          const clean = (stdout + '\n' + stderr).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\[999D\[J/g, '');
          // 提取关键错误行
          const key = clean.split('\n').map(l => l.replace(/^[│├└┌■●◇\s]+/, '').trim()).filter(Boolean);
          const noMatch = key.find(l => /no matching/i.test(l));
          const available = key.filter(l => l.startsWith('- ')).map(l => l.slice(2));
          let msg: string;
          if (noMatch) {
            msg = available.length ? `${noMatch} (available: ${available.join(', ')})` : noMatch;
          } else {
            msg = key.slice(-3).join(' | ') || `Process exited with code ${code}`;
          }
          const err: any = new Error(msg);
          if (noMatch) err.status = 404;
          reject(err);
        } else {
          resolve(stdout);
        }
      });
      proc.on('error', (e: Error) => reject(e));
    });
  }

  private _copyDir(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this._copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
