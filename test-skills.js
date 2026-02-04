#!/usr/bin/env node
/**
 * Skills 系统测试脚本
 */

const { loadSkills } = require('./dist/Skills');
const { config } = require('./dist/Config');

console.log('='.repeat(60));
console.log('Testing Skills System');
console.log('='.repeat(60));
console.log();

// 测试加载 skills（从配置目录）
const skillsDir = config.getConfigPath('skills', true);
console.log(`Skills directory: ${skillsDir}`);
console.log(`Loading skills from config directory...`);
console.log();

try {
    const skills = loadSkills(skillsDir);

    console.log(`✓ Successfully loaded ${skills.length} skill(s)`);
    console.log();

    if (skills.length > 0) {
        console.log('Loaded Skills:');
        console.log('-'.repeat(60));

        skills.forEach((skill, index) => {
            console.log(`${index + 1}. ${skill.name}`);
            console.log(`   Description: ${skill.description.substring(0, 80)}...`);
            console.log(`   Path: ${skill.path}`);
            if (skill.license) {
                console.log(`   License: ${skill.license}`);
            }
            console.log();
        });
    } else {
        console.log('⚠ No skills found in config directory.');
        console.log(`   Please add skills to: ${skillsDir}`);
    }

    console.log('='.repeat(60));
    console.log('✓ Skills system test completed successfully!');
    console.log('='.repeat(60));

} catch (error) {
    console.error('✗ Error testing skills system:', error.message);
    console.error(error.stack);
    process.exit(1);
}
