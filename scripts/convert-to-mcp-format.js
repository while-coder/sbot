/**
 * 将所有工具的返回值转换为 MCP 标准格式
 * 运行: node scripts/convert-to-mcp-format.js
 */

const fs = require('fs');
const path = require('path');

// 文件路径
const FILES_TO_CONVERT = [
    'src/FileSystemTools/index.ts',
    'src/Skills/tools.ts'
];

// 读取文件
function readFile(filePath) {
    return fs.readFileSync(path.join(__dirname, '..', filePath), 'utf-8');
}

// 写入文件
function writeFile(filePath, content) {
    fs.writeFileSync(path.join(__dirname, '..', filePath), content, 'utf-8');
}

// 转换函数
function convertToMCPFormat(content) {
    // 1. 添加类型导入
    if (!content.includes('import { createTextContent')) {
        content = content.replace(
            /import { LoggerService } from ['"].*?['"];/,
            `import { LoggerService } from '../LoggerService';\nimport { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from './mcpTypes';`
        );
    }

    // 2. 转换所有 func 的返回类型
    content = content.replace(
        /func: async \((\{[^}]+\}): any\) => \{/g,
        'func: async ($1: any): Promise<MCPToolResult> => {'
    );

    // 3. 转换错误返回 - 简单错误
    content = content.replace(
        /return JSON\.stringify\(\s*\{\s*success:\s*false,\s*error:\s*([^}]+)\s*\}\s*\);/g,
        'return createErrorResult($1);'
    );

    // 4. 转换成功返回 - 这个需要更智能的处理
    // 先简单处理一些常见情况

    return content;
}

// 主函数
function main() {
    console.log('开始转换工具返回格式...\n');

    for (const filePath of FILES_TO_CONVERT) {
        console.log(`处理文件: ${filePath}`);

        try {
            const content = readFile(filePath);
            const converted = convertToMCPFormat(content);

            // 备份原文件
            const backupPath = filePath + '.backup';
            writeFile(backupPath, content);
            console.log(`  ✓ 备份到: ${backupPath}`);

            // 写入转换后的文件
            writeFile(filePath, converted);
            console.log(`  ✓ 已转换\n`);
        } catch (error) {
            console.error(`  ✗ 错误: ${error.message}\n`);
        }
    }

    console.log('转换完成！');
    console.log('\n注意: 请手动检查和调整生成的代码，特别是成功返回的部分。');
}

main();
