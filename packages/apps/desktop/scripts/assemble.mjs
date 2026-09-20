// 资源组装（tauri build 的 beforeBuildCommand）：
// 1. 复制 pnpm run build:sbot 的发布产物 → src-tauri/resources/sbot/
// 2. 在其中 npm install --omit=dev 安装生产外部依赖（含原生模块 prebuild）
// 3. 下载 nodejs.org 官方 node 二进制 → src-tauri/binaries/node-<triple>[.exe]
// 结果按 (sbot 版本, node 版本, triple) 缓存，二次构建直接复用。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url)); // packages/apps/desktop/scripts
const desktopDir = resolve(scriptDir, '..');               // packages/apps/desktop
const repoRoot = resolve(desktopDir, '../../..');          // 仓库根
const sbotDistDir = join(repoRoot, 'packages/backend/sbot/dist');
const sbotResourceDir = join(desktopDir, 'src-tauri/resources/sbot');
const binariesDir = join(desktopDir, 'src-tauri/binaries');
const cacheRoot = join(homedir(), '.sbot-desktop-cache');

const { nodeVersion } = JSON.parse(readFileSync(join(desktopDir, 'scripts/versions.json'), 'utf8'));
const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTriple();
const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
const sidecarName = `node-${triple}${process.platform === 'win32' ? '.exe' : ''}`;

await main();

async function main() {
  assertSbotDist();
  assertNodeAbi();

  await assembleResources();
  await fetchNodeSidecar();

  console.log(`[assemble] done (triple=${triple}, node=v${nodeVersion})`);
}

function assertSbotDist() {
  for (const rel of ['package.json', 'dist/index.js', 'webui']) {
    if (!existsSync(join(sbotDistDir, rel))) {
      fail(`缺少 sbot 构建产物 ${rel}，请先运行 pnpm run build:sbot`);
    }
  }
}

// 原生模块 prebuild 按「执行 npm install 的 node」的 ABI 选择，必须与捆绑 Node 主版本一致
function assertNodeAbi() {
  const pinnedMajor = Number(nodeVersion.split('.')[0]);
  const hostMajor = Number(process.versions.node.split('.')[0]);
  if (pinnedMajor !== hostMajor) {
    fail(`当前 node v${process.versions.node} 与捆绑 Node v${nodeVersion} 主版本不一致（ABI 不匹配会导致原生模块加载失败），请用 v${pinnedMajor}.x 运行组装`);
  }
}

async function assembleResources() {
  const sbotVersion = JSON.parse(readFileSync(join(sbotDistDir, 'package.json'), 'utf8')).version;
  // 缓存键带产物最新 mtime：同版本号重构建后旧缓存自动失效
  const distMtime = distLatestMtime(sbotDistDir);
  const cacheKey = `${sbotVersion}-node${nodeVersion}-${triple}-${distMtime}`;
  const cacheDir = join(cacheRoot, 'resources', cacheKey);

  if (existsSync(join(cacheDir, 'package.json'))) {
    console.log(`[assemble] 命中资源缓存 ${cacheKey}`);
    rmSync(sbotResourceDir, { recursive: true, force: true });
    mkdirSync(dirname(sbotResourceDir), { recursive: true });
    cpSync(cacheDir, sbotResourceDir, { recursive: true });
    return;
  }

  console.log(`[assemble] 复制 sbot 发布产物（${sbotVersion}）→ resources/sbot`);
  rmSync(sbotResourceDir, { recursive: true, force: true });
  mkdirSync(dirname(sbotResourceDir), { recursive: true });
  cpSync(sbotDistDir, sbotResourceDir, { recursive: true });

  console.log('[assemble] npm install --omit=dev（生产依赖 + 原生模块 prebuild）…');
  const r = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: sbotResourceDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) fail('npm install 失败');

  // npm install 会按 dependencies 清理 bundled 的 workspace 包（它们只在
  // bundledDependencies 里、不在 dependencies 里），装完从 dist 产物回填
  const srcNodeModules = join(sbotDistDir, 'node_modules');
  if (existsSync(srcNodeModules)) {
    cpSync(srcNodeModules, join(sbotResourceDir, 'node_modules'), { recursive: true, force: true });
  }

  mkdirSync(cacheRoot, { recursive: true });
  rmSync(cacheDir, { recursive: true, force: true });
  cpSync(sbotResourceDir, cacheDir, { recursive: true });
  console.log(`[assemble] 资源已缓存 ${cacheKey}`);
}

async function fetchNodeSidecar() {
  const dest = join(binariesDir, sidecarName);
  if (existsSync(dest) && isRuntime(dest)) {
    console.log('[assemble] node sidecar 已存在且可执行，跳过下载');
    return;
  }

  const cacheDir = join(cacheRoot, 'node', `v${nodeVersion}-${triple}`);
  const cachedBinary = join(cacheDir, nodeExe);
  if (existsSync(cachedBinary)) {
    mkdirSync(binariesDir, { recursive: true });
    cpSync(cachedBinary, dest);
    chmodUnix(dest);
    console.log('[assemble] node sidecar 命中缓存');
    return;
  }

  const { os, arch, ext } = platformInfo();
  const baseUrl = `https://nodejs.org/dist/v${nodeVersion}`;
  const archiveName = `node-v${nodeVersion}-${os}-${arch}.${ext}`;
  const archive = join(tmpdir(), archiveName);

  console.log(`[assemble] 下载 ${baseUrl}/${archiveName} …`);
  await download(`${baseUrl}/${archiveName}`, archive);
  const shasums = join(tmpdir(), 'SHASUMS256.txt');
  await download(`${baseUrl}/SHASUMS256.txt`, shasums);
  verifySha256(archive, shasums);

  const extractDir = join(cacheDir, 'extract');
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  // Windows 用 Expand-Archive（Git Bash 的 GNU tar 不认 zip），其余平台用 bsdtar；
  // 用相对路径调用，避免 Windows bsdtar 把盘符 "C:" 当成远程主机
  const r = process.platform === 'win32'
    ? spawnSync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${extractDir}' -Force`,
      ], { stdio: 'inherit' })
    : spawnSync('tar', ['-xf', basename(archive), '-C', relative(tmpdir(), extractDir)], {
        cwd: tmpdir(),
        stdio: 'inherit',
      });
  if (r.status !== 0) fail('解压 node 压缩包失败');

  const binary = join(extractDir, `node-v${nodeVersion}-${os}-${arch}`, process.platform === 'win32' ? nodeExe : `bin/${nodeExe}`);
  if (!existsSync(binary)) fail(`解压后未找到 node 二进制：${binary}`);

  mkdirSync(cacheDir, { recursive: true });
  cpSync(binary, cachedBinary);
  chmodUnix(cachedBinary);
  rmSync(extractDir, { recursive: true, force: true });

  mkdirSync(binariesDir, { recursive: true });
  cpSync(cachedBinary, dest);
  chmodUnix(dest);
  console.log('[assemble] node sidecar 就绪');
}

// 校验 sidecar 确实能执行（dev 占位空文件在 tauri build 时必须被真实二进制替换）
function isRuntime(path) {
  const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
  return r.status === 0 && /v\d/.test(r.stdout ?? '');
}

function platformInfo() {
  const os = { win32: 'win', darwin: 'darwin', linux: 'linux' }[process.platform];
  if (!os) fail(`不支持的平台：${process.platform}`);
  const arch = { x64: 'x64', arm64: 'arm64' }[process.arch];
  if (!arch) fail(`不支持的架构：${process.arch}`);
  // win-arm64 的 node zip 与原生模块 prebuild 均不全，这里只覆盖主流组合
  if (os === 'win' && arch === 'arm64') fail('暂不支持 win-arm64 打包');
  const ext = os === 'win' ? 'zip' : 'tar.gz';
  return { os, arch, ext };
}

async function download(url, dest) {
  const resp = await fetch(url);
  if (!resp.ok) fail(`下载失败 ${url}：${resp.status} ${resp.statusText}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await resp.arrayBuffer()));
}

function distLatestMtime(root) {
  let latest = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else latest = Math.max(latest, statSync(p).mtimeMs);
    }
  }
  return Math.floor(latest);
}

function verifySha256(file, shasumsPath) {
  const name = basename(file);
  const expected = readFileSync(shasumsPath, 'utf8')
    .split('\n')
    .find((l) => l.endsWith(name));
  if (!expected) fail(`SHASUMS256.txt 中找不到 ${name}`);
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== expected.trim().split(/\s+/)[0]) fail(`SHA256 校验失败：${name}`);
}

function chmodUnix(path) {
  if (process.platform !== 'win32') chmodSync(path, 0o755);
}

function hostTriple() {
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch] ?? process.arch;
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

function fail(message) {
  console.error(`[assemble] ${message}`);
  process.exit(1);
}
