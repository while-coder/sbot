import { execSync } from 'child_process';
import { cpSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const extId = `${pkg.name}-${pkg.version}`;
const extensionsDir = join(homedir(), '.vscode', 'extensions');
const targetDir = join(extensionsDir, extId);

console.log(`Building extension...`);
execSync('pnpm run build', { cwd: root, stdio: 'inherit' });

console.log(`Installing to ${targetDir}`);
mkdirSync(targetDir, { recursive: true });

cpSync(join(root, 'dist'), join(targetDir, 'dist'), { recursive: true });
cpSync(join(root, 'media'), join(targetDir, 'media'), { recursive: true });
cpSync(join(root, 'package.json'), join(targetDir, 'package.json'));

console.log(`Done! Reload VS Code to activate the extension.`);
