import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const CONFIG_DIR = '.sbot';
const CONFIG_FILE = 'settings.json';
function getConfigPath() {
    return join(process.cwd(), CONFIG_DIR, CONFIG_FILE);
}
export function readLocalConfig() {
    const path = getConfigPath();
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function writeLocalConfig(cfg) {
    const dir = join(process.cwd(), CONFIG_DIR);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}
//# sourceMappingURL=localConfig.js.map