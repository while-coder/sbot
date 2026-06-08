#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TARGETS = {
  app: {
    tagPrefix: 'app-v',
    tauriConf: 'packages/app/src-tauri/tauri.conf.json',
    pkgJson: 'packages/app/package.json',
  },
  helper: {
    tagPrefix: 'helper-v',
    tauriConf: 'packages/helper/src-tauri/tauri.conf.json',
    pkgJson: 'packages/helper/package.json',
  },
};

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const BUMP_TYPES = ['patch', 'minor', 'major'];

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error('Usage: node scripts/release.js <app|helper> [<version>|patch|minor|major]');
  console.error('  no arg          : use current version in tauri.conf.json, just tag & push');
  console.error('  patch|minor|major: bump version, commit, tag & push');
  console.error('  X.Y.Z           : set version, commit, tag & push');
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function bumpVersion(version, type) {
  const [maj, min, pat] = version.split('.').map(Number);
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function isWorkingTreeClean() {
  const out = execSync('git status --porcelain', { encoding: 'utf8' });
  return out.trim().length === 0;
}

function tagExists(tag) {
  try {
    execSync(`git rev-parse -q --verify "refs/tags/${tag}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const target = process.argv[2];
  const arg = process.argv[3];

  if (!target || !TARGETS[target]) usage(`unknown target "${target || ''}"`);

  const cfg = TARGETS[target];
  const root = path.resolve(__dirname, '..');
  const confPath = path.join(root, cfg.tauriConf);
  const pkgPath = path.join(root, cfg.pkgJson);

  const conf = readJson(confPath);
  const currentVersion = conf.version;

  let nextVersion = currentVersion;
  let mutate = false;

  if (arg) {
    if (BUMP_TYPES.includes(arg)) {
      nextVersion = bumpVersion(currentVersion, arg);
      mutate = true;
    } else if (SEMVER_RE.test(arg)) {
      nextVersion = arg;
      mutate = nextVersion !== currentVersion;
    } else {
      usage(`invalid version/bump "${arg}"`);
    }
  }

  const tag = `${cfg.tagPrefix}${nextVersion}`;

  console.log(`target  : ${target}`);
  console.log(`current : ${currentVersion}`);
  console.log(`next    : ${nextVersion}`);
  console.log(`tag     : ${tag}`);
  console.log('');

  if (tagExists(tag)) {
    console.error(`error: tag "${tag}" already exists`);
    process.exit(1);
  }

  if (mutate) {
    if (!isWorkingTreeClean()) {
      console.error('error: working tree not clean — commit or stash before bumping version');
      process.exit(1);
    }
    conf.version = nextVersion;
    writeJson(confPath, conf);

    if (fs.existsSync(pkgPath)) {
      const pkg = readJson(pkgPath);
      if (pkg.version !== undefined) {
        pkg.version = nextVersion;
        writeJson(pkgPath, pkg);
      }
    }

    run(`git add "${cfg.tauriConf}" "${cfg.pkgJson}"`);
    run(`git commit -m "chore(${target}): release v${nextVersion}"`);
  }

  run(`git tag -a "${tag}" -m "${target} v${nextVersion}"`);
  run('git push');
  run(`git push origin "${tag}"`);

  console.log('');
  console.log(`✓ pushed tag ${tag} — workflow "Release ${target === 'app' ? 'App' : 'Helper'}" triggered`);
}

main();
