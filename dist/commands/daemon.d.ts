export interface DaemonOptions {
    config?: string;
    status?: boolean;
    stop?: boolean;
}
export declare function daemonCommand(options: DaemonOptions): Promise<void>;
//# sourceMappingURL=daemon.d.ts.map