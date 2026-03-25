const { execSync } = require('child_process');
const path = require('path');

const distPkg = require(path.join(__dirname, '../dist/package.json'));
const version = distPkg.version;
const tag = `sbot:${version}`;

const command = process.argv[2];

if (command === 'build') {
  console.log(`Building Docker image ${tag}...`);
  execSync(`docker build -t ${tag} -f packages/sbot/Dockerfile packages/sbot/dist`, { stdio: 'inherit' });
  console.log(`Built ${tag}`);
} else if (command === 'save') {
  console.log(`Saving Docker image ${tag} to sbot.tar...`);
  execSync(`docker save -o sbot.tar ${tag}`, { stdio: 'inherit' });
  console.log(`Saved sbot.tar (${tag})`);
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: node packages/sbot/scripts/docker.js <build|save>');
  process.exit(1);
}
