export interface PromptBuildParams {
    taskFile: string;
    tasksDir: string;
    systemPrompt?: string;
    contextFiles?: string[];
    workingDir: string;
}
export declare function buildPrompt(params: PromptBuildParams): string;
export declare function buildVerifyPrompt(taskContent: string, implementOutput: string, gitDiff: string, customTemplate?: string): string;
export declare function buildTestPrompt(taskContent: string, implementOutput: string, gitDiff: string, customTemplate?: string): string;
//# sourceMappingURL=prompt-builder.d.ts.map