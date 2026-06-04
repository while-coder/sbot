import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { spawnSync } from "child_process";
import axios from "axios";
import { LoggerService } from "../Core/LoggerService";
import { config } from "../Core/Config";

const logger = LoggerService.getLogger("BinaryManager.ts");

/**
 * cloudflared 版本与平台二进制 URL/SHA256。
 * 升级版本时同步更新这两个映射 —— 校验值在 cloudflared release 页面
 * （https://github.com/cloudflare/cloudflared/releases）的 checksums 文件中。
 */
const CLOUDFLARED_VERSION = "2026.2.0";
const BASE_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

interface PlatformAsset {
    url: string;
    sha256: string;
    /** 是否为 .tgz 压缩包（mac），需要解压；否则视为裸二进制 */
    archive: boolean;
}

const ASSETS: Record<string, PlatformAsset> = {
    "darwin-x64": {
        url: `${BASE_URL}/cloudflared-darwin-amd64.tgz`,
        sha256: "685688a260c324eb8d9c9434ca22f0ce4f504fd6acd0706787c4833de8d6eb17",
        archive: true,
    },
    "darwin-arm64": {
        url: `${BASE_URL}/cloudflared-darwin-arm64.tgz`,
        sha256: "ba99c6f87320236b9f842c3ba4b9526f687560125b7b43a581201579543ca4ff",
        archive: true,
    },
    "linux-x64": {
        url: `${BASE_URL}/cloudflared-linux-amd64`,
        sha256: "176746db3be7dc7bd48f3dd287c8930a4645ebb6e6700f883fddda5a4c307c16",
        archive: false,
    },
    "linux-arm64": {
        url: `${BASE_URL}/cloudflared-linux-arm64`,
        sha256: "03c5d58e283f521d752dc4436014eb341092edf076eb1095953ab82debe54a8e",
        archive: false,
    },
    "win32-x64": {
        url: `${BASE_URL}/cloudflared-windows-amd64.exe`,
        sha256: "b3279f2186a1c3c438ad5865e802bbbec26090c5d3fdb4ac1113f1143a94837a",
        archive: false,
    },
};

function platformKey(): string {
    const platform = process.platform;
    const arch = process.arch;
    return `${platform}-${arch}`;
}

function binaryName(): string {
    return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

function whichSync(cmd: string): string | undefined {
    try {
        const probe = process.platform === "win32" ? "where" : "which";
        const r = spawnSync(probe, [cmd], { encoding: "utf8" });
        if (r.status === 0) {
            const first = r.stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
            if (first && fs.existsSync(first)) return first;
        }
    } catch { }
    return undefined;
}

async function downloadFile(url: string, dest: string, onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.(`Downloading ${url}`);
    const res = await axios.get(url, {
        responseType: "stream",
        maxRedirects: 5,
        timeout: 90_000,
    });
    await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(dest);
        res.data.on("error", reject);
        out.on("error", reject);
        out.on("finish", () => resolve());
        res.data.pipe(out);
    });
}

function sha256OfFile(filePath: string): string {
    const hash = crypto.createHash("sha256");
    const buf = fs.readFileSync(filePath);
    hash.update(buf);
    return hash.digest("hex");
}

/** 解压 .tgz 中名为 cloudflared 的成员到 dest（不依赖 npm tar 包，调系统 tar） */
function extractTgzCloudflared(tgzPath: string, destBinary: string): void {
    const destDir = path.dirname(destBinary);
    const tar = spawnSync("tar", ["-xzf", tgzPath, "-C", destDir, "cloudflared"], { encoding: "utf8" });
    if (tar.status !== 0) {
        throw new Error(`tar -xzf failed (status=${tar.status}): ${tar.stderr || tar.stdout}`);
    }
    const extracted = path.join(destDir, "cloudflared");
    if (extracted !== destBinary) {
        if (fs.existsSync(destBinary)) fs.unlinkSync(destBinary);
        fs.renameSync(extracted, destBinary);
    }
}

export class BinaryManager {
    private readonly binDir: string;

    constructor(binDir?: string) {
        this.binDir = binDir ?? config.getConfigPath("bin", true);
    }

    /**
     * 拿到一个可用的 cloudflared 二进制路径：
     *   1. 系统 PATH 中已有 -> 直接用
     *   2. ~/.sbot/bin/cloudflared 存在 -> 用本地缓存
     *   3. 都没有 -> 从 GitHub Release 下载（带 SHA256 校验）
     *
     * @param onProgress 用于把"下载中 / 校验中"等阶段消息透传到 admin 日志
     */
    async ensure(onProgress?: (msg: string) => void): Promise<string> {
        const sysPath = whichSync("cloudflared");
        if (sysPath) return sysPath;

        const local = path.join(this.binDir, binaryName());
        if (fs.existsSync(local) && this.isExecutable(local)) {
            return local;
        }

        return await this.download(local, onProgress);
    }

    private isExecutable(p: string): boolean {
        try {
            if (process.platform === "win32") return true;
            fs.accessSync(p, fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    }

    private async download(dest: string, onProgress?: (msg: string) => void): Promise<string> {
        const key = platformKey();
        const asset = ASSETS[key];
        if (!asset) {
            throw new Error(
                `No cloudflared download available for platform "${key}". `
                + `Please install it manually and put on PATH: `
                + `https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`
            );
        }

        if (!fs.existsSync(this.binDir)) fs.mkdirSync(this.binDir, { recursive: true });

        if (asset.archive) {
            const tmp = path.join(os.tmpdir(), `cloudflared-${Date.now()}.tgz`);
            try {
                await downloadFile(asset.url, tmp, onProgress);
                onProgress?.("Verifying SHA256 ...");
                this.verifyChecksum(tmp, asset.sha256);
                onProgress?.("Extracting ...");
                extractTgzCloudflared(tmp, dest);
            } finally {
                if (fs.existsSync(tmp)) {
                    try { fs.unlinkSync(tmp); } catch { }
                }
            }
        } else {
            await downloadFile(asset.url, dest, onProgress);
            onProgress?.("Verifying SHA256 ...");
            this.verifyChecksum(dest, asset.sha256);
        }

        if (process.platform !== "win32") {
            try {
                fs.chmodSync(dest, 0o755);
            } catch (e: any) {
                logger.warn(`chmod failed: ${e?.message ?? e}`);
            }
        }

        onProgress?.(`cloudflared ${CLOUDFLARED_VERSION} installed at ${dest}`);
        return dest;
    }

    private verifyChecksum(file: string, expected: string): void {
        const actual = sha256OfFile(file);
        if (actual.toLowerCase() !== expected.toLowerCase()) {
            try { fs.unlinkSync(file); } catch { }
            throw new Error(`SHA256 mismatch for ${file}: expected ${expected}, got ${actual}`);
        }
    }
}
