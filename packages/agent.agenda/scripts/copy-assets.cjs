const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'prompts');
const target = path.join(root, 'dist', 'prompts');

if (fs.existsSync(source)) {
  fs.cpSync(source, target, { recursive: true });
}
