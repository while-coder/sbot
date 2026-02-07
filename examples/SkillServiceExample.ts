/**
 * SkillService 使用示例
 * 展示如何使用依赖注入容器管理技能服务
 */

import { Container } from "../src/Core";
import { SkillService } from "../src/Skills";

async function main() {
    console.log("🎯 SkillService 示例\n");

    // 创建容器
    const container = new Container();

    // 注册技能目录配置
    const skillsDir = "./skills"; // 替换为实际的技能目录路径
    container.registerInstance("SkillsDir", skillsDir);

    console.log(`📁 技能目录: ${skillsDir}\n`);

    // 解析 SkillService（自动注入 SkillsDir）
    const skillService = await container.resolve(SkillService);

    // 获取所有技能
    const allSkills = skillService.getAllSkills();
    console.log(`✅ 已加载 ${allSkills.length} 个技能:\n`);

    for (const skill of allSkills) {
        console.log(`  📦 ${skill.name}`);
        console.log(`     描述: ${skill.description}`);
        console.log(`     路径: ${skill.path}\n`);
    }

    // 搜索技能
    if (allSkills.length > 0) {
        const query = "test"; // 搜索关键词
        const searchResults = skillService.searchSkills(query);
        console.log(`🔍 搜索 "${query}" 的结果: ${searchResults.length} 个匹配\n`);

        for (const skill of searchResults) {
            console.log(`  📦 ${skill.name} - ${skill.description}`);
        }
        console.log();
    }

    // 根据名称获取技能
    if (allSkills.length > 0) {
        const firstSkillName = allSkills[0].name;
        const skill = skillService.getSkillByName(firstSkillName);
        if (skill) {
            console.log(`📄 获取技能: ${skill.name}\n`);

            // 读取 SKILL.md 内容
            const content = skillService.readSkillContent(firstSkillName);
            if (content) {
                console.log(`📖 SKILL.md 内容预览 (前 200 字符):`);
                console.log(content.substring(0, 200) + "...\n");
            }

            // 获取技能文件路径
            const skillMdPath = skillService.getSkillFilePath(firstSkillName, "SKILL.md");
            console.log(`📂 SKILL.md 完整路径: ${skillMdPath}\n`);
        }
    }

    // 获取统计信息
    const stats = skillService.getStatistics();
    console.log(`📊 技能统计:`);
    console.log(`   总数: ${stats.totalSkills}`);
    console.log(`   技能名称: ${stats.skillNames.join(", ")}`);
    console.log(`   技能目录: ${stats.skillsDir}\n`);

    console.log("✨ 示例完成！");
}

// 运行示例
main().catch(console.error);
