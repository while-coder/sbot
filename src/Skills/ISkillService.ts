import { Skill } from "./types";

/**
 * Skill 服务接口
 */
export interface ISkillService {
    /**
     * 获取所有已加载的技能
     */
    getAllSkills(): Skill[];

    /**
     * 获取 Skills 系统提示词
     */
    getSystemMessage(): string | null;
}

/**
 * ISkillService 的依赖注入标识符
 */
export const ISkillService = Symbol.for("ISkillService");
