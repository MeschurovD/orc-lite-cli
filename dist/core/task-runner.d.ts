import { type Notifier } from '../services/notifier.js';
import type { OrcLiteConfig, TaskDefinition, TaskRunResult } from '../types.js';
export declare function runTask(task: TaskDefinition, taskIndex: number, queueIndex: number, config: OrcLiteConfig, configPath: string, workingDir: string, totalTasks: number, notifier: Notifier | null, projectName?: string, queueName?: string): Promise<TaskRunResult>;
//# sourceMappingURL=task-runner.d.ts.map