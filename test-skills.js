#!/usr/bin/env node
/**
 * Skills 系统测试脚本
 */

const { loadSkills } = require('./dist/Skills');
const path = require('path');

console.log('='.repeat(60));
console.log('Testing Skills System');
console.log('='.repeat(60));
console.log();

// 测试加载 skills
const skillsDir = path.join(__dirname, 'skills');
console.log(`Loading skills from: ${skillsDir}`);
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
        console.log('⚠ No skills found. Please add skills to the skills/ directory.');
    }

    console.log('='.repeat(60));
    console.log('✓ Skills system test completed successfully!');
    console.log('='.repeat(60));

} catch (error) {
    console.error('✗ Error testing skills system:', error.message);
    console.error(error.stack);
    process.exit(1);
}
