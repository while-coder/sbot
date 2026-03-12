/**
 * Skill 解析器
 * 负责解析 SKILL.md 文件，提取 YAML frontmatter 中的元数据
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Skill, SkillMetadata } from './types';

/**
 * 解析单个 skill 目录中的 SKILL.md 文件
 * @param skillDir skill 目录的绝对路径
 * @returns 解析成功返回 Skill 对象，失败返回 null
 */
export function parseSkill(skillDir: string): Skill | null {
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    // 检查 SKILL.md 是否存在
    if (!fs.existsSync(skillMdPath)) {
        return null;
    }

    try {
        // 读取文件内容
        const content = fs.readFileSync(skillMdPath, 'utf-8');

        // 验证文件是否以 --- 开头（YAML frontmatter）
        if (!content.trimStart().startsWith('---')) {
            return null;
        }

        // 提取 YAML frontmatter
        // 格式: ---\nyaml content\n---\nmarkdown content
        const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            return null;
        }

        const frontmatterText = frontmatterMatch[1];

        // 解析 YAML
        const metadata = yaml.load(frontmatterText) as SkillMetadata;

        const name = metadata.name ?? path.basename(skillDir)

        // 构造 Skill 对象
        const skill: Skill = {
            name: name,
            description: metadata.description ?? name,
            license: metadata.license,
            path: skillDir
        };

        return skill;

    } catch (error: any) {
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
