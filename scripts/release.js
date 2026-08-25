#!/usr/bin/env node
const { execSync } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const TARGETS = {
  app: {
    tagPrefix: 'app-v',
    rootField: 'appVersion',
    tauriConf: 'packages/apps/client/src-tauri/tauri.conf.json',
    pkgJson: 'packages/apps/client/package.json',
    companionPkgJsons: ['packages/apps/sbot-vscode/package.json'],
    overwriteExistingRelease: true,
  },
  sbot: {
    tagPrefix: 'sbot-v',
    rootField: 'sbotVersion',
    pkgJson: 'packages/backend/sbot/package.json',
    overwriteExistingRelease: true,
    releaseNotes: {
      en: 'packages/backend/sbot/ReleaseNote.md',
      zh: 'packages/backend/sbot/ReleaseNote.zh.md',
    },
  },
  cli: {
    tagPrefix: 'cli-v',
    pkgJson: 'packages/apps/sbot-cli/package.json',
    overwriteExistingRelease: true,
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

function commandSucceeds(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
  return commandSucceeds(`git rev-parse -q --verify "refs/tags/${tag}"`);
}

function remoteTagExists(tag) {
  return commandSucceeds(`git ls-remote --exit-code origin "refs/tags/${tag}"`);
}

function confirmTagOverwrite(tag, existing) {
  const locations = [
    existing.local ? '本地' : '',
    existing.remote ? 'origin 远程' : '',
  ].filter(Boolean).join('、');
  const prompt = `⚠ tag ${tag} 已存在（${locations}）。删除后重新打 tag 并推送？[y/N] `;
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (answer) => {
      if (resolved) return;
      resolved = true;
      input.close();
      resolve(answer);
    };
    input.once('close', () => finish(false));
    input.question(prompt, (answer) => finish(answer.trim().toLowerCase() === 'y'));
  });
}

function deleteExistingTag(tag, existing) {
  if (existing.remote) {
    run(`git push origin --delete "${tag}"`);
  }
  if (existing.local) {
    run(`git tag -d "${tag}"`);
  }
}

async function main() {
  const target = process.argv[2];
  const arg = process.argv[3];

  if (!target || !TARGETS[target]) usage(`unknown target "${target || ''}"`);

  const cfg = TARGETS[target];
  const root = path.resolve(__dirname, '..');
  const rootPkgPath = path.join(root, 'package.json');
  const rootPkg = readJson(rootPkgPath);
  const confPath = cfg.tauriConf ? path.join(root, cfg.tauriConf) : null;
  const pkgPath = path.join(root, cfg.pkgJson);

  const conf = confPath ? readJson(confPath) : null;
  const pkg = fs.existsSync(pkgPath) ? readJson(pkgPath) : null;

  // version source of truth: root package.json field (appVersion / sbotVersion) when defined,
  // otherwise the target's own package.json
  const confUsesPkgJson = conf ? conf.version === '../package.json' : true;
  const currentVersion = (cfg.rootField && rootPkg[cfg.rootField])
    || (pkg && pkg.version)
    || (conf && !confUsesPkgJson ? conf.version : null);

  if (!currentVersion || !SEMVER_RE.test(currentVersion)) {
    const sources = [cfg.rootField && `package.json#${cfg.rootField}`, cfg.pkgJson, cfg.tauriConf]
      .filter(Boolean)
      .join(' or ');
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

  // companion pkg.json files that should track the main version (e.g. vscode-extension follows app)
  const companions = (cfg.companionPkgJsons || []).map((rel) => {
    const p = path.join(root, rel);
    const json = readJson(p);
    return { rel, path: p, json, outOfSync: json.version !== nextVersion };
  });
  const companionsChanged = companions.some((c) => c.outOfSync);
  const rootOutOfSync = Boolean(cfg.rootField) && rootPkg[cfg.rootField] !== nextVersion;

  const mutate = versionChanged || notesChanged || companionsChanged || rootOutOfSync;
  const tag = `${cfg.tagPrefix}${nextVersion}`;

  console.log(`target  : ${target}`);
  console.log(`current : ${currentVersion}`);
  console.log(`next    : ${nextVersion}`);
  console.log(`tag     : ${tag}`);
  if (notesChanged) console.log('notes   : updated from ReleaseNote files');
  console.log('');

  const existingTag = {
    local: tagExists(tag),
    remote: remoteTagExists(tag),
  };
  if (existingTag.local || existingTag.remote) {
    if (!cfg.overwriteExistingRelease) {
      console.error(`error: tag "${tag}" already exists`);
      process.exit(1);
    }
    if (!(await confirmTagOverwrite(tag, existingTag))) {
      console.log('✗ 已取消，未删除任何 tag，发版中止');
      process.exitCode = 1;
      return;
    }
  }

  if (mutate) {
    if (!isWorkingTreeClean()) {
      console.error('error: working tree not clean — commit or stash before releasing');
      process.exit(1);
    }

    const filesToAdd = [];

    // root package.json is the version source of truth for app/sbot —
    // targeted replace keeps its formatting (blank-line grouping in scripts) intact
    if (cfg.rootField && rootOutOfSync) {
      const content = fs.readFileSync(rootPkgPath, 'utf8');
      const re = new RegExp(`("${cfg.rootField}"\\s*:\\s*")[^"]*(")`);
      if (re.test(content)) {
        fs.writeFileSync(rootPkgPath, content.replace(re, `$1${nextVersion}$2`));
      } else {
        rootPkg[cfg.rootField] = nextVersion;
        writeJson(rootPkgPath, rootPkg);
      }
      filesToAdd.push('package.json');
      console.log(`root     : package.json ${cfg.rootField} → ${nextVersion}`);
    }

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

    for (const c of companions) {
      if (c.outOfSync) {
        c.json.version = nextVersion;
        writeJson(c.path, c.json);
        filesToAdd.push(c.rel);
        console.log(`companion: bumped ${c.rel} → ${nextVersion}`);
      }
    }

    const commitMsg = versionChanged
      ? `chore(${target}): release v${nextVersion}`
      : notesChanged
        ? `chore(${target}): sync release notes for v${nextVersion}`
        : `chore(${target}): sync companion versions for v${nextVersion}`;

    run(`git add ${filesToAdd.map((f) => `"${f}"`).join(' ')}`);
    run(`git commit -m "${commitMsg}"`);
  }

  if (existingTag.local || existingTag.remote) {
    deleteExistingTag(tag, existingTag);
  }

  run(`git tag -a "${tag}" -m "${target} v${nextVersion}"`);
  run('git push');
  run(`git push origin "${tag}"`);

  const workflowName = { app: 'Release App', sbot: 'Release sbot', cli: 'Release CLI' }[target] || `Release ${target}`;
  console.log('');
  console.log(`✓ pushed tag ${tag} — workflow "${workflowName}" triggered`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
