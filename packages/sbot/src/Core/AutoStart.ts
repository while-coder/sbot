import os from "os";
import path from "path";
import fs from "fs";
import { execSync, execFileSync } from "child_process";

const APP_NAME = "sbot";

// ─── Windows: Startup 文件夹 + .vbs 静默启动 ──────────────────────
function getWindowsStartupPath(): string {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.vbs`);
}

function enableWindows(): void {
    const nodePath = process.execPath;
    const sbotBin = require.resolve("@qingfeng346/sbot");
    // 使用 VBScript 静默启动，不弹出命令行窗口
    const vbs = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run """${nodePath}"" ""${sbotBin}""", 0, False\r\n`;
    const vbsPath = getWindowsStartupPath();
    // 清理旧的注册表条目（如果存在）
    try { execFileSync("reg", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", APP_NAME, "/f"], { stdio: "pipe" }); } catch { /* ignore */ }
    fs.writeFileSync(vbsPath, vbs, "utf-8");
}

function disableWindows(): void {
    const vbsPath = getWindowsStartupPath();
    if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath);
    // 也清理旧的注册表条目
    try { execFileSync("reg", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", APP_NAME, "/f"], { stdio: "pipe" }); } catch { /* ignore */ }
}

function isEnabledWindows(): boolean {
    return fs.existsSync(getWindowsStartupPath());
}

// ─── macOS: LaunchAgent plist ──────────────────────────────────────
function getLaunchAgentPath(): string {
    return path.join(os.homedir(), "Library", "LaunchAgents", `com.${APP_NAME}.plist`);
}

function enableMacOS(): void {
    const plistPath = getLaunchAgentPath();
    const nodePath = process.execPath;
    const sbotBin = require.resolve("@qingfeng346/sbot");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.${APP_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${sbotBin}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${path.join(os.homedir(), `.${APP_NAME}`, "stdout.log")}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), `.${APP_NAME}`, "stderr.log")}</string>
</dict>
</plist>`;
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, plist, "utf-8");
    execSync(`launchctl load -w "${plistPath}"`, { stdio: "pipe" });
}

function disableMacOS(): void {
    const plistPath = getLaunchAgentPath();
    if (fs.existsSync(plistPath)) {
        try { execSync(`launchctl unload -w "${plistPath}"`, { stdio: "pipe" }); } catch { /* ignore */ }
        fs.unlinkSync(plistPath);
    }
}

function isEnabledMacOS(): boolean {
    return fs.existsSync(getLaunchAgentPath());
}

// ─── Linux: systemd user service ──────────────────────────────────
function getSystemdServicePath(): string {
    return path.join(os.homedir(), ".config", "systemd", "user", `${APP_NAME}.service`);
}

function enableLinux(): void {
    const servicePath = getSystemdServicePath();
    const nodePath = process.execPath;
    const sbotBin = require.resolve("@qingfeng346/sbot");
    const unit = `[Unit]
Description=sbot - AI agent server
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${sbotBin}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
    fs.mkdirSync(path.dirname(servicePath), { recursive: true });
    fs.writeFileSync(servicePath, unit, "utf-8");
    execSync("systemctl --user daemon-reload", { stdio: "pipe" });
    execSync(`systemctl --user enable ${APP_NAME}.service`, { stdio: "pipe" });
}

function disableLinux(): void {
    const servicePath = getSystemdServicePath();
    try { execSync(`systemctl --user disable ${APP_NAME}.service`, { stdio: "pipe" }); } catch { /* ignore */ }
    if (fs.existsSync(servicePath)) {
        fs.unlinkSync(servicePath);
    }
    try { execSync("systemctl --user daemon-reload", { stdio: "pipe" }); } catch { /* ignore */ }
}

function isEnabledLinux(): boolean {
    try {
        const out = execSync(`systemctl --user is-enabled ${APP_NAME}.service`, { stdio: "pipe" }).toString().trim();
        return out === "enabled";
    } catch {
        return false;
    }
}

// ─── 统一接口 ─────────────────────────────────────────────────────
export function enableAutoStart(): void {
    const platform = process.platform;
    if (platform === "win32") enableWindows();
    else if (platform === "darwin") enableMacOS();
    else if (platform === "linux") enableLinux();
    else throw new Error(`Unsupported platform: ${platform}`);
}

export function disableAutoStart(): void {
    const platform = process.platform;
    if (platform === "win32") disableWindows();
    else if (platform === "darwin") disableMacOS();
    else if (platform === "linux") disableLinux();
    else throw new Error(`Unsupported platform: ${platform}`);
}

export function isAutoStartEnabled(): boolean {
    const platform = process.platform;
    if (platform === "win32") return isEnabledWindows();
    if (platform === "darwin") return isEnabledMacOS();
    if (platform === "linux") return isEnabledLinux();
    return false;
}
