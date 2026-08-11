import os from 'os';
import path from 'path';
import { GlobalLoggerService } from "scorpio.ai";
import { SkillService, loadSkillPrompt } from "agent.skill";
import { config } from "../Core/Config.js";

const promptOverrides = config.getConfigPath('prompts', true);

export const globalSkillService = new SkillService(
    loadSkillPrompt('skills/system.txt', promptOverrides),
    loadSkillPrompt('skills/tool_read_skill_file.txt', promptOverrides),
    loadSkillPrompt('skills/tool_list_skill_files.txt', promptOverrides),
    loadSkillPrompt('skills/tool_execute_skill_script.txt', promptOverrides),
    GlobalLoggerService.getLoggerService(),
);


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
        'Agents': path.join(os.homedir(), '.agents/skills'),
        'Claude Code': path.join(os.homedir(), '.claude/skills'),
        'SkillHub': path.join(os.homedir(), 'skills'),
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
