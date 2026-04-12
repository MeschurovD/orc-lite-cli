import type { SchedulerJob, SchedulerRegistry } from '../types.js';
export declare function getSchedulerDir(): string;
export declare function getSchedulerPath(): string;
export declare function getDaemonPidPath(): string;
export declare function isDaemonRunning(): boolean;
export declare function getDaemonPid(): number | null;
export declare function loadRegistry(): SchedulerRegistry;
export declare function saveRegistry(registry: SchedulerRegistry): void;
/**
 * Parse schedule string into an absolute Date.
 *
 * Supported formats:
 *   "2:30"                  — next occurrence of 2:30 (today or tomorrow)
 *   "14:30"                 — next occurrence of 14:30
 *   "2026-04-09"            — that date at 00:00
 *   "2026-04-09 2:30"       — that date at 2:30
 *   "2026-04-09T02:30:00"   — ISO 8601 as-is
 */
export declare function parseScheduleTime(input: string): Date;
export declare function formatScheduleTime(date: Date): string;
export declare function registerJob(params: {
    repo: string;
    config?: string;
    queueIndex: number;
    queueName?: string;
    scheduledAt: Date;
}): SchedulerJob;
export declare function cancelJob(id: string): boolean;
export declare function cancelJobsForRepo(repoPath: string): number;
export declare function removeJob(id: string): void;
export declare function updateJobStatus(id: string, status: SchedulerJob['status']): void;
export declare function getScheduledJobs(): SchedulerJob[];
export interface DaemonTimer {
    jobId: string;
    timer: ReturnType<typeof setTimeout>;
}
/**
 * Schedule all pending jobs from the registry.
 * Returns a list of active timers so they can be cancelled on reload.
 */
export declare function scheduleJobs(jobs: SchedulerJob[], onRun: (job: SchedulerJob) => Promise<void>): DaemonTimer[];
export declare function clearTimers(timers: DaemonTimer[]): void;
//# sourceMappingURL=scheduler.d.ts.map