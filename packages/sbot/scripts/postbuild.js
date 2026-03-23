const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || 'dist';
const distDir = path.resolve(__dirname, '..', outputDir);
const rootDir = path.resolve(__dirname, '..');
const monorepoRoot = path.resolve(rootDir, '../..');

// 解析 pnpm-workspace.yaml 中的 catalog 版本（简单行解析，无需 yaml 库）
const catalog = {};
const workspaceYaml = path.join(monorepoRoot, 'pnpm-workspace.yaml');
if (fs.existsSync(workspaceYaml)) {
  let inCatalog = false;
  for (const line of fs.readFileSync(workspaceYaml, 'utf-8').replace(/\r\n/g, '\n').split('\n')) {
    if (/^catalog:/.test(line)) { inCatalog = true; continue; }
    if (inCatalog && /^\S/.test(line) && !/^\s/.test(line)) { inCatalog = false; }
    if (inCatalog) {
      const m = line.match(/^\s{2}["']?([^"':]+)["']?\s*:\s*["']?([^"'\s]+)["']?/);
      if (m) catalog[m[1].trim()] = m[2].trim();
    }
  }
}

// 将 catalog: 引用替换为实际版本号
function resolveVersion(name, version) {
  if (version === 'catalog:' || version === 'catalog:default') {
    const resolved = catalog[name];
    if (!resolved) console.warn(`warning: catalog entry "${name}" not found`);
    return resolved || version;
  }
  return version;
}

// 读取自身的 package.json
const selfPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

// 扫描 monorepo packages/ 目录，建立 packageName -> dir 映射
const packagesRoot = path.resolve(rootDir, '..');
const workspaceMap = {}; // name -> dir
for (const entry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgJson = path.join(packagesRoot, entry.name, 'package.json');
  if (!fs.existsSync(pkgJson)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
  if (pkg.name) workspaceMap[pkg.name] = path.join(packagesRoot, entry.name);
}

// 从 dependencies 中识别本地包（file: 或 workspace:*），递归处理传递 workspace 依赖
const localPackages = {}; // name -> 源码根目录
const allDeps = {};

const queue = Object.entries(selfPkg.dependencies || {});
const visited = new Set();

while (queue.length > 0) {
  const [name, version] = queue.shift();
  if (visited.has(name)) continue;
  visited.add(name);

  if (typeof version !== 'string') continue;
  if (version.startsWith('file:')) {
    const relPath = version.slice('file:'.length);
    localPackages[name] = path.resolve(rootDir, relPath);
  } else if (version.startsWith('workspace:')) {
    if (workspaceMap[name]) {
      localPackages[name] = workspaceMap[name];
    } else {
      console.warn(`warning: workspace package "${name}" not found in ${packagesRoot}`);
      allDeps[name] = version;
    }
  } else {
    allDeps[name] = resolveVersion(name, version);
  }
}

// 收集本地包的 dependencies（递归处理传递 workspace 依赖）
const localNames = new Set(Object.keys(localPackages));
const processedLocal = new Set();

let localQueue = Object.entries(localPackages);
while (localQueue.length > 0) {
  const [, pkgDir] = localQueue.shift();
  if (processedLocal.has(pkgDir)) continue;
  processedLocal.add(pkgDir);

  const pkgPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.warn(`warning: ${pkgPath} not found, skipping`);
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    if (localNames.has(name)) continue;
    if (typeof version === 'string' && version.startsWith('workspace:')) {
      if (workspaceMap[name]) {
        localPackages[name] = workspaceMap[name];
        localNames.add(name);
        localQueue.push([name, workspaceMap[name]]);
      } else {
        console.warn(`warning: transitive workspace package "${name}" not found in ${packagesRoot}`);
      }
    } else {
      if (!allDeps[name]) allDeps[name] = resolveVersion(name, version);
    }
  }
}

// 按名称排序
const sortedDeps = {};
for (const key of Object.keys(allDeps).sort()) {
  sortedDeps[key] = allDeps[key];
}

// 生成 dist/package.json（用于 pnpm publish 和 Docker 部署）
// 发布根为 dist/，编译产物在 dist/dist/，因此路径去掉首段 "dist/" 前缀
const toPublishPath = (p) => p.replace(/^\.?\/?dist\//, '');

const publishBin = {};
for (const [k, v] of Object.entries(selfPkg.bin || {})) {
  publishBin[k] = toPublishPath(v);
}

const isRelease = outputDir === 'dist';

const distPkg = {
  name: selfPkg.name,
  version: selfPkg.version,
  releasenote: selfPkg.releasenote || '',
  description: selfPkg.description || '',
  ...(selfPkg.repository ? { repository: selfPkg.repository } : {}),
  ...(selfPkg.homepage ? { homepage: selfPkg.homepage } : {}),
  ...(selfPkg.bugs ? { bugs: selfPkg.bugs } : {}),
  ...(selfPkg.license ? { license: selfPkg.license } : {}),
  main: toPublishPath(selfPkg.main || 'dist/dist/index.js'),
  bin: publishBin,
  engines: selfPkg.engines || { node: '>=18' },
  dependencies: sortedDeps,
  ...(isRelease ? { bundledDependencies: Object.keys(localPackages) } : {}),
};
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(distPkg, null, 2));
console.log(`${outputDir}/package.json: ${Object.keys(sortedDeps).length} external dependencies`);

// release 模式：复制本地包的编译产物到 node_modules/<pkgName>/
if (isRelease) {
  for (const [pkgName, pkgDir] of Object.entries(localPackages)) {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
    const mainField = pkg.main || 'dist/index.js';
    const srcDir = path.join(pkgDir, path.dirname(mainField));

    const targetDir = path.join(distDir, 'node_modules', pkgName);
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(srcDir, targetDir, { recursive: true });

    // 生成 package.json 供 require 使用
    const miniPkg = { name: pkgName, version: pkg.version || '0.0.1', main: './index.js' };
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(miniPkg, null, 2));
    console.log(`${pkgName}: ${srcDir} -> ${targetDir}`);
  }
}

// 复制 skills/ 到 dist/skills/
const skillsSrc = path.join(rootDir, 'skills');
const skillsDst = path.join(distDir, 'skills');
if (fs.existsSync(skillsSrc)) {
  if (fs.existsSync(skillsDst)) fs.rmSync(skillsDst, { recursive: true });
  fs.cpSync(skillsSrc, skillsDst, { recursive: true });
  console.log(`skills: ${skillsSrc} -> ${skillsDst}`);
}

// 复制 prompts/ 到 dist/prompts/
const promptsSrc = path.join(rootDir, 'prompts');
const promptsDst = path.join(distDir, 'prompts');
if (fs.existsSync(promptsSrc)) {
  if (fs.existsSync(promptsDst)) fs.rmSync(promptsDst, { recursive: true });
  fs.cpSync(promptsSrc, promptsDst, { recursive: true });
  console.log(`prompts: ${promptsSrc} -> ${promptsDst}`);
}

// 复制 website/dist 到 dist/webui/
const webuitSrc = workspaceMap['sbot-website'] ? path.join(workspaceMap['sbot-website'], 'dist') : null;
const webuiDst = path.join(distDir, 'webui');
if (webuitSrc && fs.existsSync(webuitSrc)) {
  if (fs.existsSync(webuiDst)) fs.rmSync(webuiDst, { recursive: true });
  fs.cpSync(webuitSrc, webuiDst, { recursive: true });
  console.log(`webui: ${webuitSrc} -> ${webuiDst}`);
} else if (isRelease) {
  console.error(`webui: ${webuitSrc ?? 'sbot-website not found'} not found, run "pnpm --filter sbot-website run build" first`);
  process.exit(1);
} else {
  console.warn(`webui: ${webuitSrc ?? 'sbot-website not found'} not found, skipping in debug mode`);
}

// 非 release 模式：将 webui 额外复制到 packages/sbot/wenui 供 debug 使用
if (!isRelease && webuitSrc && fs.existsSync(webuitSrc)) {
  const debugWebuiDst = path.join(rootDir, 'wenui');
  if (fs.existsSync(debugWebuiDst)) fs.rmSync(debugWebuiDst, { recursive: true });
  fs.cpSync(webuitSrc, debugWebuiDst, { recursive: true });
  console.log(`webui (debug): ${webuitSrc} -> ${debugWebuiDst}`);
}

// 复制 LICENSE 到 dist/
const licenseSrc = path.join(monorepoRoot, 'LICENSE');
const licenseDst = path.join(distDir, 'LICENSE');
if (fs.existsSync(licenseSrc)) {
  fs.copyFileSync(licenseSrc, licenseDst);
  console.log(`license: ${licenseSrc} -> ${licenseDst}`);
}

// 复制 README 到 dist/（供 npm 包页面展示）
const readmeSrc = path.join(monorepoRoot, 'README.md');
const readmeZhSrc = path.join(monorepoRoot, 'README.zh.md');
const readmeDst = path.join(distDir, 'README.md');
if (fs.existsSync(readmeSrc)) {
  fs.copyFileSync(readmeSrc, readmeDst);
  console.log(`readme: ${readmeSrc} -> ${readmeDst}`);
} else if (fs.existsSync(readmeZhSrc)) {
  fs.copyFileSync(readmeZhSrc, readmeDst);
  console.log(`readme: ${readmeZhSrc} -> ${readmeDst}`);
}

console.log('postbuild: done');
