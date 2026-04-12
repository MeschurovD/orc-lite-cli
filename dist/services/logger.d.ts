import { PassThrough, type Writable } from 'node:stream';
export declare function createCaptureStream(): {
    stream: PassThrough;
    getOutput: () => string;
};
export declare const pipelineLogger: {
    info(msg: string): void;
    success(msg: string): void;
    error(msg: string): void;
    separator(): void;
};
export interface TaskLogger {
    step(msg: string): void;
    success(msg: string): void;
    error(msg: string): void;
    raw(msg: string): void;
    openCodexFrame(): void;
    closeCodexFrame(): void;
    fileStream: Writable;
    teeStream: Writable;
    close(): void;
}
export declare function createTaskLogger(taskName: string, logsDir: string): TaskLogger;
export declare function createFileLogger(logFile: string): {
    info(msg: string): void;
    error(msg: string): void;
    close(): void;
};
//# sourceMappingURL=logger.d.ts.map