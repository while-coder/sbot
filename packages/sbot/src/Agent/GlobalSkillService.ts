import path from 'path';
import { GlobalLoggerService, SkillService } from "scorpio.ai";
import { config } from "../Core/Config.js";

export const globalSkillService = new SkillService(GlobalLoggerService.getLoggerService());

/**
 * 内置 Skills 目录（项目自带）
 */
export const BUILTIN_SKILLS_DIR = path.join(__dirname, '../../skills');

export function initGlobalSkillService() {
    globalSkillService.registerSkillsDir(BUILTIN_SKILLS_DIR);
    globalSkillService.registerSkillsDir(config.getSkillsPath());
}

export function refreshGlobalSkillService() {
    globalSkillService.reset();
    globalSkillService.registerSkillsDir(BUILTIN_SKILLS_DIR);
    globalSkillService.registerSkillsDir(config.getSkillsPath());
}
