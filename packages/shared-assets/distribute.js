const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const pkg = require("./package.json");
const entries = pkg.distribute;

if (!entries) {
  console.log("No distribute config found in package.json");
  process.exit(0);
}

const baseDir = __dirname;

for (const [dest, config] of Object.entries(entries)) {
  const destDir = path.resolve(baseDir, dest);
  fs.mkdirSync(destDir, { recursive: true });

  if (config && config.type === "tauri-icons") {
    const src = path.resolve(baseDir, config.source);
    const iconPng = path.resolve(destDir, "icon.png");
    fs.cpSync(src, iconPng);
    console.log(`${config.source} -> ${path.relative(baseDir, iconPng)}`);
    const desktopDir = path.resolve(destDir, "../..");
    console.log(`Running tauri icon in ${path.relative(baseDir, desktopDir)}...`);
    execSync(`npx tauri icon ${path.resolve(destDir, "icon.png")}`, {
      cwd: desktopDir,
      stdio: "inherit",
    });
    continue;
  }

  for (const item of config) {
    const from = typeof item === "string" ? item : item.from;
    const to = typeof item === "string" ? item : item.to;
    const src = path.resolve(baseDir, from);
    const target = path.resolve(destDir, to);
    fs.cpSync(src, target);
    console.log(`${from} -> ${path.relative(baseDir, target)}`);
  }
}
