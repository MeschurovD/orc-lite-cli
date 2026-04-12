import type { OrcLiteConfig, TaskDefinition } from '../types.js';
export declare const CONFIG_FILENAME = "orc-lite.config.json";
export declare function loadConfig(configPath?: string): {
    config: OrcLiteConfig;
    path: string;
};
export declare function saveConfig(configPath: string, config: OrcLiteConfig): void;
export declare function updateTaskStatus(configPath: string, queueIndex: number, taskIndex: number, updates: Partial<TaskDefinition>): void;
export declare function updateQueueStatus(configPath: string, queueIndex: number, status: 'pending' | 'in_progress' | 'done' | 'failed'): void;
export declare function getTaskBranchName(task: TaskDefinition): string;
export declare function renderCommitMessage(template: string | undefined, vars: {
    task_name: string;
    task_file: string;
    first_line: string;
    index: number;
    total: number;
}): string;
//# sourceMappingURL=config.d.ts.map