#!/usr/bin/env node
/**
 * 一键发版（多目标）：打印摘要 → 二次确认 → 写版本 → commit → (tag 已存在时确认清理) → 打 tag → 推送。
 *
 * 目标：
 *   app   打 app-vX.Y.Z tag，触发 "Release App" workflow
 *   sbot  打 sbot-vX.Y.Z tag，触发 "Release sbot" workflow，并把 ReleaseNote 同步进 pkg.json
 *   cli   打 cli-vX.Y.Z tag，触发 "Release CLI" workflow
 *
 * 版本以根 package.json 的 appVersion / sbotVersion（或目标自身 package.json）为准；
 * tauri.conf.json 的 version 指向 "../package.json" 时自动跟随，无需单独写。
 *
 * 确认规则（参考 wmdebugger/scripts/release.js）：
 *   - tag 已存在（本地或远程）：y/N 确认后删除旧 tag 再重打并推送
 *   - tag 不存在：回车确认发版，Ctrl+C 取消
 *
 * 用法：
 *   node scripts/release.js <app|sbot|cli> [<version>|patch|minor|major]
 */
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

const WORKFLOW_NAMES = { app: 'Release App', sbot: 'Release sbot', cli: 'Release CLI' };

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

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function ok(cmd) {
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
  return sh('git status --porcelain').length === 0;
}

function tagExists(tag) {
  return ok(`git rev-parse -q --verify "refs/tags/${tag}"`);
}

function remoteTagExists(tag) {
  try {
    execSync(`git ls-remote --exit-code origin "refs/tags/${tag}"`, { stdio: 'ignore' });
    return true;
  } catch (error) {
    // git ls-remote 在远程可达但 ref 不存在时返回 2；其他错误（网络/权限）必须中断发版
    if (error && typeof error === 'object' && error.status === 2) return false;
    throw new Error(`无法检查 origin 上的 tag ${tag}，请确认网络和 Git 权限`);
  }
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

  // ---------- 前置检查（任何破坏性操作之前） ----------
  let status;
  try {
    status = sh('git status --porcelain');
  } catch {
    console.error('✗ 不在 git 仓库中');
    process.exit(1);
  }
  if (mutate && status) {
    console.error('✗ 工作区有未提交改动，请先 commit 或 stash：');
    console.error(status);
    process.exit(1);
  }

  const branch = sh('git rev-parse --abbrev-ref HEAD');
  if (branch === 'HEAD') {
    console.error('✗ 当前处于 detached HEAD，请先 checkout 到发布分支');
    process.exit(1);
  }

  const originUrl = sh('git remote get-url origin');

  // ---------- 打印发版摘要 ----------
  console.log('────────────────────────────────────────');
  console.log(`  目标:      ${target}`);
  console.log(`  当前版本:  ${currentVersion}`);
  console.log(`  发布版本:  ${tag}`);
  console.log(`  分支:      ${branch}`);
  console.log(`  远程:      ${originUrl}`);
  console.log('────────────────────────────────────────');
  if (notesChanged) console.log('  notes:     将从 ReleaseNote 文件同步进 pkg.json');

  // ---------- tag 状态检测：确认前说明将删除已有还是新建 ----------
  const existingTag = {
    local: tagExists(tag),
    remote: remoteTagExists(tag),
  };
  const tagWhere = [
    existingTag.local ? '本地' : null,
    existingTag.remote ? 'origin 远程' : null,
  ].filter(Boolean).join('、');

  if ((existingTag.local || existingTag.remote) && !cfg.overwriteExistingRelease) {
    console.error(`error: tag "${tag}" already exists`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  let needClean = false;
  if (existingTag.local || existingTag.remote) {
    console.log(`  tag 状态:  已存在（${tagWhere}）→ 将删除后重打`);
    const ans = await ask(`⚠ tag ${tag} 已存在（${tagWhere}）。删除后重新打 tag 并推送？[y/N] `);
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('✗ 已取消，未删除任何 tag，发版中止');
      rl.close();
      process.exit(1);
    }
    needClean = true;
  } else {
    console.log('  tag 状态:  新建');
    await ask('回车确认发版，Ctrl+C 取消...');
  }

  // ---------- 确认通过后才执行写操作 ----------
  try {
    if (mutate) {
      if (!isWorkingTreeClean()) {
        console.error('✗ 工作区有未提交改动，请先 commit 或 stash 后再发版');
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
        console.log(`✓ 根 package.json ${cfg.rootField} → ${nextVersion}`);
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
          console.log(`✓ companion ${c.rel} → ${nextVersion}`);
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

    if (needClean) {
      deleteExistingTag(tag, existingTag);
      console.log(`✓ 已清理旧 tag ${tag}`);
    }

    run(`git tag -a "${tag}" -m "${target} v${nextVersion}"`);
    run('git push');
    run(`git push origin "${tag}"`);

    console.log('');
    console.log(`✓ 发版完成！tag ${tag} 已推送 — workflow "${WORKFLOW_NAMES[target]}" 已触发`);
    rl.close();
    process.exit(0);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
