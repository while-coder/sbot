import type { ILogger } from 'scorpio.ai';

export interface FileSystemToolRuntime {
    description: string;
    logger?: Pick<ILogger, 'error' | 'warn'>;
}
