const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../dist');
const rootDir = path.resolve(__dirname, '..');

// 读取自身的 package.json
const selfPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

// 从 dependencies 中自动识别 file: 本地包
const localPackages = {}; // name -> 源码根目录
const allDeps = {};

for (const [name, version] of Object.entries(selfPkg.dependencies || {})) {
  if (typeof version === 'string' && version.startsWith('file:')) {
    const relPath = version.slice('file:'.length);
    localPackages[name] = path.resolve(rootDir, relPath);
  } else {
    allDeps[name] = version;
  }
}

// 收集本地包的 dependencies + peerDependencies
const localNames = new Set(Object.keys(localPackages));

for (const [pkgName, pkgDir] of Object.entries(localPackages)) {
  const pkgPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.warn(`warning: ${pkgPath} not found, skipping`);
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  for (const depField of ['dependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(pkg[depField] || {})) {
      if (localNames.has(name)) continue;
      if (!allDeps[name]) {
        allDeps[name] = version;
      }
    }
  }
}

// 按名称排序
const sortedDeps = {};
for (const key of Object.keys(allDeps).sort()) {
  sortedDeps[key] = allDeps[key];
}

// 生成 dist/package.json
const distPkg = {
  name: selfPkg.name,
  version: selfPkg.version,
  private: true,
  main: "index.js",
  dependencies: sortedDeps,
};
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(distPkg, null, 2));
console.log(`dist/package.json: ${Object.keys(sortedDeps).length} dependencies`);

// 复制本地包的编译产物到 dist/ 并生成 package.json
for (const [pkgName, pkgDir] of Object.entries(localPackages)) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
  // 解析 main 字段得到 dist 目录，如 "dist/index.js" -> "dist"
  const mainField = pkg.main || 'dist/index.js';
  const srcDir = path.join(pkgDir, path.dirname(mainField));

  const targetDir = path.join(distDir, pkgName);
  if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true });
  fs.cpSync(srcDir, targetDir, { recursive: true });

  // 生成 package.json（供 Dockerfile 中 cp 到 node_modules 后 require 使用）
  const miniPkg = { name: pkgName, version: pkg.version || "0.0.1", main: "./index.js" };
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(miniPkg, null, 2));
  console.log(`${pkgName}: ${srcDir} -> ${targetDir}`);
}

// 复制 prompts 目录到 dist/
const promptsSrc = path.join(rootDir, 'src', 'prompts');
const promptsDst = path.join(distDir, 'prompts');
if (fs.existsSync(promptsSrc)) {
  if (fs.existsSync(promptsDst)) fs.rmSync(promptsDst, { recursive: true });
  fs.cpSync(promptsSrc, promptsDst, { recursive: true });
  console.log(`prompts: ${promptsSrc} -> ${promptsDst}`);
}

console.log('postbuild: done');
