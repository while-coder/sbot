import os from 'os';
import path from 'path';
import { GlobalLoggerService, SkillService } from "scorpio.ai";
import { config } from "../Core/Config.js";

export const globalSkillService = new SkillService(GlobalLoggerService.getLoggerService());


/**
 * 获取所有 Skills 目录映射（来源名 → 路径）
 * - builtin: 内置 skills
 * - user: 用户配置目录 ~/.sbot/skills
 * - .agents: ~/.agents/skills
 * - .claude: ~/.claude/skills
 */
export function getSkillsDirsMap(): Record<string, string> {
    return {
        '内置': path.join(__dirname, '../../skills'),
        '.agents': path.join(os.homedir(), '.agents/skills'),
        'Claude Code': path.join(os.homedir(), '.claude/skills'),
        '全局': config.getSkillsPath(),
    };
}

export function initGlobalSkillService() {
    for (const dir of Object.values(getSkillsDirsMap())) {
        globalSkillService.registerSkillsDir(dir);
    }
}

export function refreshGlobalSkillService() {
    globalSkillService.reset();
    for (const dir of Object.values(getSkillsDirsMap())) {
        globalSkillService.registerSkillsDir(dir);
    }
}
