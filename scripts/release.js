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
  sbot: {
    tagPrefix: 'sbot-v',
    pkgJson: 'packages/sbot/package.json',
    releaseNotes: {
      en: 'packages/sbot/ReleaseNote.md',
      zh: 'packages/sbot/ReleaseNote.zh.md',
    },
  },
};

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const BUMP_TYPES = ['patch', 'minor', 'major'];

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(`Usage: node scripts/release.js <${Object.keys(TARGETS).join('|')}> [<version>|patch|minor|major]`);
  console.error('  no arg          : use current version, sync release notes (sbot), tag & push');
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
  const confPath = cfg.tauriConf ? path.join(root, cfg.tauriConf) : null;
  const pkgPath = path.join(root, cfg.pkgJson);

  const conf = confPath ? readJson(confPath) : null;
  const pkg = fs.existsSync(pkgPath) ? readJson(pkgPath) : null;

  // tauri.conf.json's version may be the literal "../package.json" — treat package.json as source of truth
  const confUsesPkgJson = conf ? conf.version === '../package.json' : true;
  const currentVersion = (pkg && pkg.version) || (conf && !confUsesPkgJson ? conf.version : null);

  if (!currentVersion || !SEMVER_RE.test(currentVersion)) {
    const sources = [cfg.pkgJson, cfg.tauriConf].filter(Boolean).join(' or ');
    console.error(`error: cannot resolve current version from ${sources}`);
    process.exit(1);
  }

  let nextVersion = currentVersion;
  let versionChanged = false;

  if (arg) {
    if (BUMP_TYPES.includes(arg)) {
      nextVersion = bumpVersion(currentVersion, arg);
      versionChanged = true;
    } else if (SEMVER_RE.test(arg)) {
      nextVersion = arg;
      versionChanged = nextVersion !== currentVersion;
    } else {
      usage(`invalid version/bump "${arg}"`);
    }
  }

  // resolve release notes from .md files — sync into pkg even when version is unchanged,
  // since the source of truth is the .md files and the workflow reads the pkg.json fields
  const releaseNotes = {};
  if (cfg.releaseNotes) {
    for (const [lang, rel] of Object.entries(cfg.releaseNotes)) {
      const p = path.join(root, rel);
      if (fs.existsSync(p)) {
        releaseNotes[lang] = fs.readFileSync(p, 'utf8').trim();
      } else {
        console.warn(`warning: ${rel} not found, skipping releasenote.${lang}`);
      }
    }
  }
  const notesChanged = pkg && (
    (releaseNotes.en !== undefined && pkg.releasenoteEn !== releaseNotes.en) ||
    (releaseNotes.zh !== undefined && pkg.releasenoteZh !== releaseNotes.zh)
  );

  const mutate = versionChanged || notesChanged;
  const tag = `${cfg.tagPrefix}${nextVersion}`;

  console.log(`target  : ${target}`);
  console.log(`current : ${currentVersion}`);
  console.log(`next    : ${nextVersion}`);
  console.log(`tag     : ${tag}`);
  if (notesChanged) console.log('notes   : updated from ReleaseNote files');
  console.log('');

  if (tagExists(tag)) {
    console.error(`error: tag "${tag}" already exists`);
    process.exit(1);
  }

  if (mutate) {
    if (!isWorkingTreeClean()) {
      console.error('error: working tree not clean — commit or stash before releasing');
      process.exit(1);
    }

    const filesToAdd = [];

    if (pkg && pkg.version !== undefined) {
      pkg.version = nextVersion;
      if (releaseNotes.en !== undefined) pkg.releasenoteEn = releaseNotes.en;
      if (releaseNotes.zh !== undefined) pkg.releasenoteZh = releaseNotes.zh;
      writeJson(pkgPath, pkg);
      filesToAdd.push(cfg.pkgJson);
    }

    // only write tauri.conf.json if it carries a literal version (not "../package.json")
    if (conf && !confUsesPkgJson && versionChanged) {
      conf.version = nextVersion;
      writeJson(confPath, conf);
      filesToAdd.push(cfg.tauriConf);
    }

    const commitMsg = versionChanged
      ? `chore(${target}): release v${nextVersion}`
      : `chore(${target}): sync release notes for v${nextVersion}`;

    run(`git add ${filesToAdd.map((f) => `"${f}"`).join(' ')}`);
    run(`git commit -m "${commitMsg}"`);
  }

  run(`git tag -a "${tag}" -m "${target} v${nextVersion}"`);
  run('git push');
  run(`git push origin "${tag}"`);

  const workflowName = { app: 'Release App', helper: 'Release Helper', sbot: 'Release sbot' }[target] || `Release ${target}`;
  console.log('');
  console.log(`✓ pushed tag ${tag} — workflow "${workflowName}" triggered`);
}

main();
