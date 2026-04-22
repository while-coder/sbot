const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const distPkg = require(path.join(__dirname, '../dist/package.json'));
const version = distPkg.version;
const tag = `qingfeng346/sbot:${version}`;
const latestTag = `qingfeng346/sbot:latest`;

const sbotDir = path.join(__dirname, '..');
const distDir = path.join(sbotDir, 'dist');

const command = process.argv[2];

if (command === 'build') {
  console.log(`Building Docker image ${tag}...`);
  execSync(`docker build -t ${tag} -t ${latestTag} -f packages/sbot/Dockerfile packages/sbot/dist`, { stdio: 'inherit' });
  console.log(`Built ${tag} and ${latestTag}`);
} else if (command === 'save') {
  console.log(`Saving Docker image ${tag} to sbot.tar...`);
  execSync(`docker save -o sbot.tar ${tag}`, { stdio: 'inherit' });
  console.log(`Saved sbot.tar (${tag})`);
} else if (command === 'publish') {
  console.log(`Pushing Docker image ${tag}...`);
  execSync(`docker push ${tag}`, { stdio: 'inherit' });
  console.log(`Pushed ${tag}`);
  console.log(`Pushing Docker image ${latestTag}...`);
  execSync(`docker push ${latestTag}`, { stdio: 'inherit' });
  console.log(`Pushed ${latestTag}`);
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: node packages/sbot/scripts/docker.js <build|save|publish>');
  process.exit(1);
}
