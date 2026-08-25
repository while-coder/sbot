#!/usr/bin/env node
/**
 * 版本号统一：以根目录 package.json 的 appVersion / sbotVersion 为唯一来源，
 * 同步到对应的子项目 package.json：
 *   appVersion  → client（含 vscode 插件，tauri.conf.json 通过 "../package.json" 引用自动跟随）
 *   sbotVersion → 后端 sbot
 *
 * cli 独立发版，不参与同步。
 *
 * 用法：
 *   pnpm sync:versions
 *   node scripts/sync-versions.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TARGETS = [
  { field: 'appVersion', files: ['packages/apps/client/package.json', 'packages/apps/sbot-vscode/package.json'] },
  { field: 'sbotVersion', files: ['packages/backend/sbot/package.json'] },
];

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let scanned = 0;
let changed = 0;

for (const { field, files } of TARGETS) {
  const version = rootPkg[field];
  if (!version) {
    console.error(`✗ 根 package.json 缺少 ${field} 字段`);
    process.exit(1);
  }

  for (const rel of files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) {
      console.warn(`⚠ ${rel} 不存在，跳过`);
      continue;
    }
    scanned++;
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (json.version === version) continue;
    const prev = json.version;
    json.version = version;
    fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n');
    changed++;
    console.log(`✓ ${rel}: ${prev} → ${version}`);
  }
}

if (changed === 0) {
  console.log(`✓ ${scanned} 个子项目版本已与根一致 (app ${rootPkg.appVersion}, sbot ${rootPkg.sbotVersion})`);
} else {
  console.log(`✓ 已同步 ${changed}/${scanned} 个子项目`);
}
