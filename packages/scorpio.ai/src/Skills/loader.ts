/**
 * Skills 加载器
 * 负责从指定目录批量加载所有 skills
 */

import fs from 'fs';
import path from 'path';
import { Skill } from './types';
import { parseSkill, isValidSkillDirectory } from './parser';
import { ILoggerService } from '../Logger';

/**
 * 从指定目录加载所有 skills
 * @param skillsDir skills 目录路径
 * @param loggerService 日志服务
 * @returns 成功解析的 Skill 对象数组
 */
export function loadSkills(skillsDir: string | undefined, loggerService: ILoggerService): Skill[] {
    const logger = loggerService.getLogger('Skills/loader');
    const skills: Skill[] = [];
    if (!skillsDir) {
        return skills;
    }
    // 检查目录是否存在
    if (!fs.existsSync(skillsDir)) {
        logger.warn(`Skills 目录不存在: ${skillsDir}`);
        return skills;
    }

    // 检查是否为目录
    const stat = fs.statSync(skillsDir);
    if (!stat.isDirectory()) {
        logger.warn(`Skills 路径不是目录: ${skillsDir}`);
        return skills;
    }

    try {
        // 读取目录下的所有子目录
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

        for (const entry of entries) {
            // 只处理目录
            if (!entry.isDirectory()) {
                continue;
            }

            const skillDir = path.join(skillsDir, entry.name);

            // 验证是否为有效的 skill 目录
            if (!isValidSkillDirectory(skillDir)) {
                continue;
            }

            // 解析 skill
            const skill = parseSkill(skillDir);
            if (skill) {
                skills.push(skill);
            } else {
                logger.warn(`加载 skill 失败: ${entry.name}`);
            }
        }

        return skills;

    } catch (error: any) {
        logger.error(`加载 skills 出错 ${skillsDir}: ${error.message}`);
        return skills;
    }
}

/**
 * 获取 skill 的完整文件路径
 * @param skill Skill 对象
 * @param relativePath skill 目录内的相对路径（如 'scripts/init.py' 或 'references/api.md'）
 * @returns 完整的文件路径
 */
export function getSkillFilePath(skill: Skill, relativePath: string): string {
    return path.join(skill.path, relativePath);
}

/**
 * 获取 SKILL.md 的完整路径
 * @param skill Skill 对象
 * @returns SKILL.md 的完整路径
 */
export function getSkillMdPath(skill: Skill): string {
    return getSkillFilePath(skill, 'SKILL.md');
}

/**
 * 读取 SKILL.md 的完整内容
 * @param skill Skill 对象
 * @param loggerService 日志服务（可选）
 * @returns SKILL.md 的内容，失败返回 null
 */
export function readSkillContent(skill: Skill, loggerService?: ILoggerService): string | null {
    const skillMdPath = getSkillMdPath(skill);

    try {
        return fs.readFileSync(skillMdPath, 'utf-8');
    } catch (error: any) {
        if (loggerService) {
            const logger = loggerService.getLogger('Skills/loader');
            logger.error(`读取 SKILL.md 失败 ${skill.name}: ${error.message}`);
        }
        return null;
    }
}
