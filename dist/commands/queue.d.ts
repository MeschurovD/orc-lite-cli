export interface QueueOptions {
    config?: string;
}
export declare function queueListCommand(options: QueueOptions): void;
export declare function queueAddCommand(name: string | undefined, options: QueueOptions & {
    dir?: string;
    schedule?: string;
}): Promise<void>;
//# sourceMappingURL=queue.d.ts.map