import type { StageResult } from '../../types.js';
import type { StageContext } from './index.js';
export interface VerifyOutput {
    approved: boolean;
    score: number;
    reason: string | null;
    short_summary: string;
    full_summary: string;
    issues: string[];
}
export declare function parseVerifyOutput(output: string): VerifyOutput | null;
export declare function runVerifyStage(ctx: StageContext): Promise<StageResult>;
//# sourceMappingURL=verify.d.ts.map