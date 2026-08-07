const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'prompts');
const target = path.join(root, 'dist', 'prompts');
const requiredFiles = [
  'note/system.txt',
  'tools/note/search.txt',
];

if (!fs.existsSync(source)) {
  throw new Error(`Note prompts directory not found: ${source}`);
}

for (const relPath of requiredFiles) {
  const filePath = path.join(source, relPath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Required Note prompt not found: ${filePath}`);
  }
}

fs.cpSync(source, target, { recursive: true });
