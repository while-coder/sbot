const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'prompts');
const target = path.join(root, 'dist', 'prompts');
const requiredFiles = [
  'skills/system.txt',
  'skills/tool_read_skill_file.txt',
  'skills/tool_list_skill_files.txt',
  'skills/tool_execute_skill_script.txt',
];

if (!fs.existsSync(source)) {
  throw new Error(`Skill prompts directory not found: ${source}`);
}

for (const relPath of requiredFiles) {
  const filePath = path.join(source, relPath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Required Skill prompt not found: ${filePath}`);
  }
}

fs.cpSync(source, target, { recursive: true });
