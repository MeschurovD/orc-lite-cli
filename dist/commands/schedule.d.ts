export interface ScheduleOptions {
    config?: string;
    list?: boolean;
    cancel?: string | boolean;
}
export declare function scheduleCommand(queueArg: string | undefined, timeArg: string | undefined, options: ScheduleOptions): Promise<void>;
//# sourceMappingURL=schedule.d.ts.map