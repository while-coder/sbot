/**
 * Skills 系统类型定义
 * 参考 mini-opencode 的设计，Skills 是为特定任务优化工作流的自包含模块
 */

/**
 * Skill 接口
 * 代表一个加载的 skill
 */
export interface Skill {
    /** Skill 名称（kebab-case 格式） */
    name: string;
    /** Skill 描述和使用场景 */
    description: string;
    /** 许可证信息（可选） */
    license?: string;
    /** Skill 目录的绝对路径 */
    path: string;
}

/**
 * Skill 元数据（从 SKILL.md 的 YAML frontmatter 解析）
 */
export interface SkillMetadata {
    /** 必需：skill 名称 */
    name: string;
    /** 必需：skill 描述 */
    description: string;
    /** 可选：许可证 */
    license?: string;
    /** 可选：允许使用的工具列表 */
    'allowed-tools'?: string[];
    /** 可选：其他元数据 */
    metadata?: Record<string, any>;
}
