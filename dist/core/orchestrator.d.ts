import type { QueueResult } from '../types.js';
export declare class DirtyWorkingTreeError extends Error {
    readonly files: string[];
    constructor(files: string[]);
}
export interface QueueRunOptions {
    configPath?: string;
    queueIndex?: number;
    dryRun?: boolean;
    cwd?: string;
    signal?: AbortSignal;
}
export declare function runQueue(options?: QueueRunOptions): Promise<QueueResult>;
export declare function runAllQueues(options: Omit<QueueRunOptions, 'queueIndex'>): Promise<void>;
//# sourceMappingURL=orchestrator.d.ts.map