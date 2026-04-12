import { simpleGit } from 'simple-git';
export class GitService {
    git;
    constructor(workingDir) {
        const options = {
            baseDir: workingDir,
            binary: 'git',
            maxConcurrentProcesses: 1,
        };
        this.git = simpleGit(options);
    }
    async ensureGitRepo() {
        const isRepo = await this.git.checkIsRepo();
        if (!isRepo) {
            throw new Error('Not a git repository. Run orc-lite from the root of a git project.');
        }
    }
    async ensureCleanWorkingTree() {
        const status = await this.git.status();
        if (!status.isClean()) {
            throw new Error('Working tree has uncommitted changes. Please commit or stash them before running orc-lite.');
        }
    }
    async ensureBranchExists(branch) {
        const branches = await this.git.branchLocal();
        if (!branches.all.includes(branch)) {
            throw new Error(`Target branch "${branch}" does not exist. Please create it before running orc-lite.`);
        }
    }
    async getCurrentBranch() {
        return this.git.revparse(['--abbrev-ref', 'HEAD']);
    }
    async branchExists(name) {
        const branches = await this.git.branchLocal();
        return branches.all.includes(name);
    }
    async checkoutBranch(name) {
        await this.git.checkout(name);
    }
    async createAndCheckoutBranch(name, from) {
        await this.git.checkoutBranch(name, from);
    }
    async deleteBranch(name) {
        await this.git.deleteLocalBranch(name, true);
    }
    async hasChanges() {
        const status = await this.git.status();
        return !status.isClean();
    }
    async getStatus() {
        return this.git.status();
    }
    async stageAndCommit(message) {
        await this.git.add('.');
        await this.git.commit(message);
    }
    async stagePathsAndCommit(paths, message) {
        await this.git.add(paths);
        await this.git.commit(message);
    }
    async pushBranch(branch) {
        await this.git.push('origin', branch);
    }
    async getDiff() {
        try {
            return await this.git.diff(['HEAD']);
        }
        catch {
            return '';
        }
    }
    async mergeBranch(sourceBranch) {
        try {
            await this.git.merge([sourceBranch, '--no-ff']);
            return { success: true, conflict: false };
        }
        catch (err) {
            const status = await this.git.status();
            if (status.conflicted.length > 0) {
                try {
                    await this.git.merge(['--abort']);
                }
                catch {
                    // ignore abort errors
                }
                return { success: false, conflict: true };
            }
            throw err;
        }
    }
}
//# sourceMappingURL=git.js.map