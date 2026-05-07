const { build } = require('esbuild');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist', 'dist');

// 读取 package.json 获取 dependencies 列表
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

// 原生模块和不可 bundle 的包标记为 external
const nativeExternals = [
  'sqlite3',
  'better-sqlite3',
  'sharp',
  'pg',
  'pg-native',
  'cpu-features',
  'ssh2',
];

// workspace 包路径（在 postbuild 中会被复制到 node_modules）
// 这些包需要 bundle 进来以减少文件数量
// 但如果有 native 依赖的子包需要 external

build({
  entryPoints: [path.join(rootDir, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: path.join(outDir, 'index.js'),
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: nativeExternals,
  // 保留动态 import 为异步以支持懒加载
  // esbuild CJS 模式下 dynamic import 会被转为 Promise.resolve().then(() => require(...))
  // 这些模块会被内联但仅在调用时执行
  logLevel: 'info',
  // 解析 workspace 包
  resolveExtensions: ['.ts', '.js', '.json'],
  tsconfig: path.join(rootDir, 'tsconfig.json'),
}).then(() => {
  console.log('esbuild bundle completed');
}).catch((err) => {
  console.error('esbuild bundle failed:', err);
  process.exit(1);
});
