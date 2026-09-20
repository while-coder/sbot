// dev 模式占位：tauri-build 会校验 externalBin 与 resources 存在，dev 不打包但编译也需要它们。
// 真实的 node sidecar 与 sbot 资源树只在 tauri build（assemble.mjs）时组装。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tauriDir = fileURLToPath(new URL('../src-tauri/', import.meta.url));

const sidecar = join(tauriDir, 'binaries', `node-${hostTriple()}${process.platform === 'win32' ? '.exe' : ''}`);
if (!existsSync(sidecar)) {
  mkdirSync(join(sidecar, '..'), { recursive: true });
  writeFileSync(sidecar, '');
  console.log(`[dev-prep] created placeholder sidecar: ${sidecar}`);
}

const resourceMarker = join(tauriDir, 'resources', 'sbot', '.placeholder');
if (!existsSync(resourceMarker)) {
  mkdirSync(join(resourceMarker, '..'), { recursive: true });
  writeFileSync(resourceMarker, 'dev placeholder — run assemble.mjs for the real bundle\n');
  console.log(`[dev-prep] created placeholder resource: ${resourceMarker}`);
}

function hostTriple() {
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch] ?? process.arch;
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}
