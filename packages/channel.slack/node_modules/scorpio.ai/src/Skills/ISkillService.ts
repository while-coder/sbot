import { Skill } from "./types";
import { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Skill 服务接口
 * 定义技能管理的标准接口
 */
export interface ISkillService {
    /**
     * 获取所有已加载的技能
     */
    getAllSkills(): Skill[];

    /**
     * 获取 Skills 系统提示词
     */
    getSystemMessage(): Promise<string | null>;

    /**
     * 获取 Skill 相关的工具
     */
    getTools(): StructuredToolInterface[];
}

/**
 * ISkillService 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const ISkillService = Symbol("ISkillService");
