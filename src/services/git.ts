import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git'

export interface MergeResult {
  success: boolean
  conflict: boolean
}

export class GitService {
  private git: SimpleGit

  constructor(workingDir: string) {
    const options: Partial<SimpleGitOptions> = {
      baseDir: workingDir,
      binary: 'git',
      maxConcurrentProcesses: 1,
    }
    this.git = simpleGit(options)
  }

  async ensureGitRepo(): Promise<void> {
    const isRepo = await this.git.checkIsRepo()
    if (!isRepo) {
      throw new Error('Not a git repository. Run orc-lite from the root of a git project.')
    }
  }

  async ensureCleanWorkingTree(): Promise<void> {
    const status = await this.git.status()
    if (!status.isClean()) {
      throw new Error(
        'Working tree has uncommitted changes. Please commit or stash them before running orc-lite.',
      )
    }
  }

  async ensureBranchExists(branch: string): Promise<void> {
    const branches = await this.git.branchLocal()
    if (!branches.all.includes(branch)) {
      throw new Error(
        `Target branch "${branch}" does not exist. Please create it before running orc-lite.`,
      )
    }
  }

  async getCurrentBranch(): Promise<string> {
    return this.git.revparse(['--abbrev-ref', 'HEAD'])
  }

  async branchExists(name: string): Promise<boolean> {
    const branches = await this.git.branchLocal()
    return branches.all.includes(name)
  }

  async checkoutBranch(name: string): Promise<void> {
    await this.git.checkout(name)
  }

  async createAndCheckoutBranch(name: string, from: string): Promise<void> {
    await this.git.checkoutBranch(name, from)
  }

  async deleteBranch(name: string): Promise<void> {
    await this.git.deleteLocalBranch(name, true)
  }

  async hasChanges(): Promise<boolean> {
    const status = await this.git.status()
    return !status.isClean()
  }

  async getStatus() {
    return this.git.status()
  }

  async stageAndCommit(message: string): Promise<void> {
    await this.git.add('.')
    await this.git.commit(message)
  }

  async stagePathsAndCommit(paths: string[], message: string): Promise<void> {
    await this.git.add(paths)
    await this.git.commit(message)
  }

  async pushBranch(branch: string): Promise<void> {
    await this.git.push('origin', branch)
  }

  async getDiff(): Promise<string> {
    try {
      return await this.git.diff(['HEAD'])
    } catch {
      return ''
    }
  }

  async mergeBranch(sourceBranch: string): Promise<MergeResult> {
    try {
      await this.git.merge([sourceBranch, '--no-ff'])
      return { success: true, conflict: false }
    } catch (err) {
      const status = await this.git.status()
      if (status.conflicted.length > 0) {
        try {
          await this.git.merge(['--abort'])
        } catch {
          // ignore abort errors
        }
        return { success: false, conflict: true }
      }
      throw err
    }
  }
}
