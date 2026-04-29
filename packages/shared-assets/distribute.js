const fs = require("fs");
const path = require("path");

const pkg = require("./package.json");
const entries = pkg.distribute;

if (!entries) {
  console.log("No distribute config found in package.json");
  process.exit(0);
}

const baseDir = __dirname;

for (const [dest, files] of Object.entries(entries)) {
  const destDir = path.resolve(baseDir, dest);
  fs.mkdirSync(destDir, { recursive: true });

  for (const item of files) {
    const from = typeof item === "string" ? item : item.from;
    const to = typeof item === "string" ? item : item.to;
    const src = path.resolve(baseDir, from);
    const target = path.resolve(destDir, to);
    fs.cpSync(src, target);
    console.log(`${from} -> ${path.relative(baseDir, target)}`);
  }
}
