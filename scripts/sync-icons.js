#!/usr/bin/env node
/**
 * 图标统一：以根目录 assets/ 下的源图标为唯一来源，重新生成 / 分发全部图标：
 *   icon-1024x1024.png → tauri icon 生成 client/src-tauri/icons 全套（含 Android/iOS）
 *   icon-128x128.png   → sbot-vscode/media/icon.png
 *   icon.svg           → sbot-vscode/media/icon.svg
 *   logo.svg           → admin/public/logo.svg
 *
 * 目标位置的图标均已提交进 git，仅在源图标变更后需要手动执行本命令刷新。
 *
 * 用法：
 *   pnpm sync:icons
 *   node scripts/sync-icons.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'assets');
const CLIENT_DIR = path.join(ROOT, 'packages/apps/client');
const TAURI_ICONS_DIR = path.join(CLIENT_DIR, 'src-tauri/icons');
const VSCODE_MEDIA_DIR = path.join(ROOT, 'packages/apps/sbot-vscode/media');
const ADMIN_PUBLIC_DIR = path.join(ROOT, 'packages/apps/admin/public');

const sourceIcon = path.join(SOURCE_DIR, 'icon-1024x1024.png');
if (!fs.existsSync(sourceIcon)) {
  console.error(`✗ 源图标不存在：${sourceIcon}`);
  process.exit(1);
}

const tauriCli = require.resolve('@tauri-apps/cli/tauri.js', { paths: [CLIENT_DIR] });
execFileSync(process.execPath, [tauriCli, 'icon', sourceIcon, '--output', TAURI_ICONS_DIR], {
  cwd: ROOT,
  stdio: 'inherit',
});

const copies = [
  { from: 'icon-128x128.png', to: path.join(VSCODE_MEDIA_DIR, 'icon.png') },
  { from: 'icon.svg', to: path.join(VSCODE_MEDIA_DIR, 'icon.svg') },
  { from: 'logo.svg', to: path.join(ADMIN_PUBLIC_DIR, 'logo.svg') },
];
for (const { from, to } of copies) {
  const src = path.join(SOURCE_DIR, from);
  if (!fs.existsSync(src)) {
    console.warn(`⚠ ${from} 不存在，跳过`);
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(src, to);
  console.log(`✓ ${from} → ${path.relative(ROOT, to)}`);
}

console.log('✓ 已从 assets/ 刷新全部图标');
