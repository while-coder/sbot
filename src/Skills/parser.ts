/**
 * Skill 解析器
 * 负责解析 SKILL.md 文件，提取 YAML frontmatter 中的元数据
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Skill, SkillMetadata } from './types';
import { getLogger } from '../logger';

const logger = getLogger('Skills/parser.ts');

/**
 * 解析单个 skill 目录中的 SKILL.md 文件
 * @param skillDir skill 目录的绝对路径
 * @returns 解析成功返回 Skill 对象，失败返回 null
 */
export function parseSkill(skillDir: string): Skill | null {
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    // 检查 SKILL.md 是否存在
    if (!fs.existsSync(skillMdPath)) {
        logger.debug(`SKILL.md not found in ${skillDir}`);
        return null;
    }

    try {
        // 读取文件内容
        const content = fs.readFileSync(skillMdPath, 'utf-8');

        // 验证文件是否以 --- 开头（YAML frontmatter）
        if (!content.trimStart().startsWith('---')) {
            logger.warn(`SKILL.md in ${skillDir} does not start with YAML frontmatter (---)`);
            return null;
        }

        // 提取 YAML frontmatter
        // 格式: ---\nyaml content\n---\nmarkdown content
        const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            logger.warn(`Failed to extract YAML frontmatter from ${skillMdPath}`);
            return null;
        }

        const frontmatterText = frontmatterMatch[1];

        // 解析 YAML
        const metadata = yaml.load(frontmatterText) as SkillMetadata;

        // 验证必需字段
        if (!metadata.name || !metadata.description) {
            logger.warn(`SKILL.md in ${skillDir} is missing required fields (name or description)`);
            return null;
        }

        // 验证 name 格式（应为 kebab-case）
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(metadata.name)) {
            logger.warn(`Skill name "${metadata.name}" is not in kebab-case format`);
            return null;
        }

        // 验证 name 长度
        if (metadata.name.length > 64) {
            logger.warn(`Skill name "${metadata.name}" exceeds 64 characters`);
            return null;
        }

        // 验证 description 长度
        if (metadata.description.length > 1024) {
            logger.warn(`Skill description in ${skillDir} exceeds 1024 characters`);
            return null;
        }

        // 验证 description 不包含 < 或 >
        if (metadata.description.includes('<') || metadata.description.includes('>')) {
            logger.warn(`Skill description in ${skillDir} contains invalid characters (< or >)`);
            return null;
        }

        // 构造 Skill 对象
        const skill: Skill = {
            name: metadata.name,
            description: metadata.description,
            license: metadata.license,
            path: skillDir
        };

        logger.debug(`Successfully parsed skill: ${skill.name} from ${skillDir}`);
        return skill;

    } catch (error: any) {
        logger.error(`Error parsing SKILL.md in ${skillDir}: ${error.message}`);
        return null;
    }
}

/**
 * 验证 skill 目录是否有效
 * @param skillDir skill 目录路径
 * @returns 是否有效
 */
export function isValidSkillDirectory(skillDir: string): boolean {
    // 检查目录是否存在
    if (!fs.existsSync(skillDir)) {
        return false;
    }

    // 检查是否为目录
    const stat = fs.statSync(skillDir);
    if (!stat.isDirectory()) {
        return false;
    }

    // 检查是否包含 SKILL.md
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    return fs.existsSync(skillMdPath);
}
