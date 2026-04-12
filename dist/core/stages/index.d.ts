import type { TaskDefinition, OrcLiteConfig, StageName, StageConfig, StageResult } from '../../types.js';
import type { TaskLogger } from '../../services/logger.js';
export interface StageContext {
    task: TaskDefinition;
    taskIndex: number;
    config: OrcLiteConfig;
    stageConfig?: StageConfig;
    workingDir: string;
    log: TaskLogger;
    implementOutput: string;
    gitDiff: string;
    taskContent: string;
}
export declare function runStage(name: StageName, ctx: StageContext): Promise<StageResult>;
//# sourceMappingURL=index.d.ts.map