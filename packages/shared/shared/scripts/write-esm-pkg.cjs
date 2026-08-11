const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'esm', 'package.json');
fs.writeFileSync(target, JSON.stringify({ type: 'module' }) + '\n');
