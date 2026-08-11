import fs from "fs";
import os from "os";
import path from "path";

let initialized = false;
let exitReason: { name: string; expected: boolean } | undefined;
let ownsState = false;
let heartbeatTimer: NodeJS.Timeout | undefined;

interface ProcessState {
    status: "running" | "closed";
    pid: number;
    startedAt: string;
    lastHeartbeat: string;
    closedAt?: string;
    reason?: string;
}

function getPaths() {
    const configDir = path.join(os.homedir(), process.env.NODE_ENV === "development" ? ".sbot-dev" : ".sbot");
    const logsDir = path.join(configDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    return {
        log: path.join(logsDir, "process.log"),
        state: path.join(logsDir, "process-state.json"),
    };
}

function append(level: "INFO" | "ERROR", message: string): void {
    try {
        fs.appendFileSync(
            getPaths().log,
            `[${new Date().toISOString()}][${level}] ${message}\n`,
            "utf8",
        );
    } catch {
        // 进程日志失败不能影响 sbot 本身。
    }
}

function readState(): ProcessState | undefined {
    try {
        return JSON.parse(fs.readFileSync(getPaths().state, "utf8")) as ProcessState;
    } catch {
        return undefined;
    }
}

function writeState(state: ProcessState): void {
    try {
        const statePath = getPaths().state;
        const tempPath = `${statePath}.${process.pid}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf8");
        try {
            fs.renameSync(tempPath, statePath);
        } catch {
            fs.rmSync(statePath, { force: true });
            fs.renameSync(tempPath, statePath);
        }
    } catch {
        // 状态文件失败不能影响 sbot 本身。
    }
}

function processExists(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: any) {
        return error?.code === "EPERM";
    }
}

export function setProcessExitReason(name: string, expected: boolean): void {
    if (exitReason && (!exitReason.expected || expected)) return;
    exitReason = { name, expected };
}

export function initializeProcessLog(): void {
    if (initialized) return;
    initialized = true;

    const statePath = getPaths().state;
    const previousStateExists = fs.existsSync(statePath);
    const previous = readState();
    if (previous?.status === "running") {
        if (processExists(previous.pid)) {
            append("ERROR", `sbot 启动时检测到已有运行实例 pid=${previous.pid} startedAt=${previous.startedAt}`);
        } else {
            append(
                "ERROR",
                `sbot 上次异常退出 pid=${previous.pid} startedAt=${previous.startedAt} lastHeartbeat=${previous.lastHeartbeat} detectedAt=${new Date().toISOString()}`,
            );
            ownsState = true;
        }
    } else if (previousStateExists && !previous) {
        append("ERROR", `sbot 上次异常退出 reason=invalid_state detectedAt=${new Date().toISOString()}`);
        ownsState = true;
    } else {
        ownsState = true;
    }

    const startedAt = new Date().toISOString();
    const state: ProcessState = {
        status: "running",
        pid: process.pid,
        startedAt,
        lastHeartbeat: startedAt,
    };
    if (ownsState) writeState(state);
    append("INFO", `sbot 启动 pid=${process.pid}`);

    heartbeatTimer = setInterval(() => {
        if (!ownsState) return;
        state.lastHeartbeat = new Date().toISOString();
        writeState(state);
    }, 60_000);
    heartbeatTimer.unref();

    process.once("exit", code => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        const expected = exitReason?.expected ?? code === 0;
        const reason = exitReason?.name ?? (code === 0 ? "normal_exit" : "unexpected_exit");
        if (ownsState) {
            const closedAt = new Date().toISOString();
            writeState({
                ...state,
                status: "closed",
                lastHeartbeat: closedAt,
                closedAt,
                reason,
            });
        }
        append(
            expected ? "INFO" : "ERROR",
            `sbot ${expected ? "正常退出" : "异常退出"} reason=${reason} pid=${process.pid} code=${code}`,
        );
    });
}
