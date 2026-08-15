export interface CommandLogger {
    debug?(message: string, ...args: any[]): void;
    info?(message: string, ...args: any[]): void;
    warn?(message: string, ...args: any[]): void;
    error?(message: string, ...args: any[]): void;
}

let logger: CommandLogger | undefined;

export function setCommandLogger(value: CommandLogger | undefined): void {
    logger = value;
}

export function getCommandLogger(): CommandLogger | undefined {
    return logger;
}
