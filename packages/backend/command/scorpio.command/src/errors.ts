export function formatCommandError(error: unknown, verbose = false): string {
    if (error instanceof Error) return verbose && error.stack ? error.stack : error.message;
    return String(error);
}
