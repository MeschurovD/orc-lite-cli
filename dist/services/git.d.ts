export interface MergeResult {
    success: boolean;
    conflict: boolean;
}
export declare class GitService {
    private git;
    constructor(workingDir: string);
    ensureGitRepo(): Promise<void>;
    ensureCleanWorkingTree(): Promise<void>;
    ensureBranchExists(branch: string): Promise<void>;
    getCurrentBranch(): Promise<string>;
    branchExists(name: string): Promise<boolean>;
    checkoutBranch(name: string): Promise<void>;
    createAndCheckoutBranch(name: string, from: string): Promise<void>;
    deleteBranch(name: string): Promise<void>;
    hasChanges(): Promise<boolean>;
    getStatus(): Promise<import("simple-git").StatusResult>;
    stageAndCommit(message: string): Promise<void>;
    stagePathsAndCommit(paths: string[], message: string): Promise<void>;
    pushBranch(branch: string): Promise<void>;
    getDiff(): Promise<string>;
    mergeBranch(sourceBranch: string): Promise<MergeResult>;
}
//# sourceMappingURL=git.d.ts.map