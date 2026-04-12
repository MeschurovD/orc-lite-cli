import { exec } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pipelineLogger, createTaskLogger } from '../services/logger.js';
import { GitService } from '../services/git.js';
import { getTaskBranchName, updateTaskStatus, renderCommitMessage } from './config.js';
import { runStage } from './stages/index.js';
const execAsync = promisify(exec);
export async function runTask(task, taskIndex, queueIndex, config, configPath, workingDir, totalTasks, notifier, projectName, queueName) {
    const taskName = task.file.replace(/\.md$/i, '');
    const logsDir = resolve(workingDir, config.logs_dir);
    const log = createTaskLogger(taskName, logsDir);
    const startTime = Date.now();
    pipelineLogger.info(`Task ${taskIndex + 1}/${totalTasks}: ${task.file}`);
    // ── Mark in progress ───────────────────────────────────────────────────────
    updateTaskStatus(configPath, queueIndex, taskIndex, {
        status: 'in_progress',
        started_at: new Date().toISOString(),
        error: undefined,
        retry_count: undefined,
    });
    const stages = task.stages ?? ['implement'];
    const git = new GitService(workingDir);
    const branchName = getTaskBranchName(task);
    const maxRetries = task.max_retries ?? config.max_retries;
    let lastError = '';
    let taskContent = '';
    try {
        const taskFilePath = resolve(workingDir, config.tasks_dir, task.file);
        taskContent = existsSync(taskFilePath) ? readFileSync(taskFilePath, 'utf-8').trim() : '';
    }
    catch { /* ignore */ }
    // ── Retry loop ─────────────────────────────────────────────────────────────
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            log.step(`retry ${attempt}/${maxRetries}`);
            pipelineLogger.info(`  retry ${attempt}/${maxRetries} for ${task.file}`);
            updateTaskStatus(configPath, queueIndex, taskIndex, { retry_count: attempt });
        }
        try {
            // ── Git setup ───────────────────────────────────────────────────────────
            if (config.git_strategy === 'branch') {
                log.step(`checkout ${config.target_branch}`);
                await git.checkoutBranch(config.target_branch);
                if (await git.branchExists(branchName)) {
                    log.step(`branch "${branchName}" exists — deleting and recreating`);
                    await git.deleteBranch(branchName);
                }
                log.step(`create branch: ${branchName}`);
                await git.createAndCheckoutBranch(branchName, config.target_branch);
            }
            // ── Pre-task hook ───────────────────────────────────────────────────────
            const hooks = resolveHooks(task.hooks, config.hooks);
            if (hooks.pre_task) {
                log.step(`pre_task hook: ${hooks.pre_task}`);
                const hookResult = await runHook(hooks.pre_task, workingDir, log);
                if (!hookResult.success) {
                    lastError = `pre_task hook failed: ${hookResult.error}`;
                    log.error(lastError);
                    continue;
                }
            }
            // ── Stage pipeline ──────────────────────────────────────────────────────
            let implementOutput = '';
            let gitDiff = '';
            let totalTokensUsed = 0;
            let totalCostUsd = 0;
            let stageFailed = false;
            let stageError = '';
            let verifyShortSummary;
            for (const stageName of stages) {
                const stageConfig = stageName !== 'implement' ? config.stages?.[stageName] : undefined;
                const stageResult = await runStage(stageName, {
                    task,
                    taskIndex,
                    config,
                    stageConfig,
                    workingDir,
                    log,
                    implementOutput,
                    gitDiff,
                    taskContent,
                });
                if (stageResult.tokensUsed)
                    totalTokensUsed += stageResult.tokensUsed;
                if (stageResult.costUsd)
                    totalCostUsd += stageResult.costUsd;
                if (stageName === 'implement') {
                    implementOutput = stageResult.output ?? '';
                    gitDiff = await git.getDiff();
                }
                if (stageName === 'verify' && stageResult.shortSummary) {
                    verifyShortSummary = stageResult.shortSummary;
                }
                if (!stageResult.success) {
                    stageFailed = true;
                    stageError = `stage "${stageName}" failed`;
                    break;
                }
                if (config.git_strategy !== 'none' && await git.hasChanges()) {
                    let commitMsg;
                    if (stageName === 'implement') {
                        const firstLine = getFirstLine(resolve(workingDir, config.tasks_dir, task.file));
                        commitMsg = renderCommitMessage(config.commit_template, {
                            task_name: taskName,
                            task_file: task.file,
                            first_line: firstLine,
                            index: taskIndex + 1,
                            total: totalTasks,
                        });
                    }
                    else {
                        commitMsg = `${stageName}: ${taskName}`;
                    }
                    log.step(`committing stage "${stageName}": "${commitMsg}"`);
                    await git.stageAndCommit(commitMsg);
                    log.success('committed');
                }
            }
            if (stageFailed) {
                lastError = stageError;
                log.error(lastError);
                continue;
            }
            // ── Post-task hook ──────────────────────────────────────────────────────
            if (hooks.post_task) {
                log.step(`post_task hook: ${hooks.post_task}`);
                const hookResult = await runHook(hooks.post_task, workingDir, log);
                if (!hookResult.success) {
                    lastError = `post_task hook failed: ${hookResult.error}`;
                    log.error(lastError);
                    continue;
                }
            }
            // ── Verification command ────────────────────────────────────────────────
            const verifyCmd = task.verification_cmd ?? config.verification_cmd;
            if (verifyCmd) {
                log.step(`verification: ${verifyCmd}`);
                const verifyResult = await runHook(verifyCmd, workingDir, log);
                if (!verifyResult.success) {
                    lastError = `verification failed: ${verifyResult.error}`;
                    log.error(lastError);
                    continue;
                }
                log.success('verification passed');
            }
            if (config.git_strategy !== 'none' && await git.hasChanges()) {
                const firstLine = getFirstLine(resolve(workingDir, config.tasks_dir, task.file));
                const commitMsg = renderCommitMessage(config.commit_template, {
                    task_name: taskName,
                    task_file: task.file,
                    first_line: firstLine,
                    index: taskIndex + 1,
                    total: totalTasks,
                });
                log.step(`committing remaining changes: "${commitMsg}"`);
                await git.stageAndCommit(commitMsg);
                log.success('committed');
            }
            // ── Merge into target ───────────────────────────────────────────────────
            if (config.git_strategy === 'branch') {
                log.step(`checkout ${config.target_branch}`);
                await git.checkoutBranch(config.target_branch);
                log.step(`merge ${branchName} → ${config.target_branch}`);
                const mergeResult = await git.mergeBranch(branchName);
                if (!mergeResult.success) {
                    const reason = `merge conflict: ${branchName} → ${config.target_branch}`;
                    log.error(reason);
                    const durationMs = Date.now() - startTime;
                    updateTaskStatus(configPath, queueIndex, taskIndex, {
                        status: 'conflict',
                        completed_at: new Date().toISOString(),
                        error: reason,
                    });
                    log.close();
                    pipelineLogger.error(`Task ${taskIndex + 1} CONFLICT — stopping queue`);
                    await notifier?.notify('task_conflict', {
                        taskFile: task.file, taskIndex, totalTasks, durationMs, error: reason, projectName, queueName,
                    });
                    return { success: false, status: 'conflict', durationMs, error: reason };
                }
            }
            // ── Push if configured ──────────────────────────────────────────────────
            if (config.push === 'each') {
                const pushBranch = config.git_strategy === 'branch'
                    ? config.target_branch
                    : await git.getCurrentBranch();
                log.step(`pushing ${pushBranch} to origin`);
                try {
                    await git.pushBranch(pushBranch);
                    log.success('pushed');
                }
                catch (err) {
                    log.error(`push failed (non-blocking): ${err.message}`);
                }
            }
            // ── Done ────────────────────────────────────────────────────────────────
            const durationMs = Date.now() - startTime;
            updateTaskStatus(configPath, queueIndex, taskIndex, {
                status: 'done',
                completed_at: new Date().toISOString(),
                tokens_used: totalTokensUsed || undefined,
                cost_usd: totalCostUsd || undefined,
            });
            log.close();
            pipelineLogger.success(`Task ${taskIndex + 1}/${totalTasks} done: ${task.file} (${Math.round(durationMs / 1000)}s)`);
            await notifier?.notify('task_done', {
                taskFile: task.file, taskIndex, totalTasks, durationMs, summary: verifyShortSummary, projectName, queueName,
            });
            return {
                success: true,
                status: 'done',
                durationMs,
                tokensUsed: totalTokensUsed || undefined,
                costUsd: totalCostUsd || undefined,
            };
        }
        catch (err) {
            lastError = err.message;
            log.error(`unexpected error: ${lastError}`);
        }
    }
    // ── All retries exhausted ──────────────────────────────────────────────────
    const durationMs = Date.now() - startTime;
    updateTaskStatus(configPath, queueIndex, taskIndex, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: lastError,
        retry_count: maxRetries > 0 ? maxRetries : undefined,
    });
    if (config.git_strategy === 'branch') {
        try {
            await git.checkoutBranch(config.target_branch);
        }
        catch { /* best effort */ }
    }
    log.close();
    const retryInfo = maxRetries > 0 ? ` (after ${maxRetries + 1} attempts)` : '';
    pipelineLogger.error(`Task ${taskIndex + 1} FAILED${retryInfo} — stopping queue`);
    pipelineLogger.error(`Reason: ${lastError}`);
    await notifier?.notify('task_failed', {
        taskFile: task.file, taskIndex, totalTasks, durationMs, error: lastError, projectName, queueName,
    });
    return { success: false, status: 'failed', durationMs, error: lastError };
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveHooks(taskHooks, globalHooks) {
    return {
        pre_task: taskHooks?.pre_task ?? globalHooks?.pre_task,
        post_task: taskHooks?.post_task ?? globalHooks?.post_task,
    };
}
async function runHook(cmd, cwd, log) {
    try {
        const { stdout, stderr } = await execAsync(cmd, { cwd });
        if (stdout)
            log.raw(stdout);
        if (stderr)
            log.raw(stderr);
        return { success: true };
    }
    catch (err) {
        const execErr = err;
        if (execErr.stdout)
            log.raw(execErr.stdout);
        if (execErr.stderr)
            log.raw(execErr.stderr);
        return { success: false, error: execErr.message };
    }
}
function getFirstLine(filePath) {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const line = content.split('\n').find((l) => l.trim().length > 0) ?? '';
        return line.replace(/^#+\s*/, '').trim();
    }
    catch {
        return '';
    }
}
//# sourceMappingURL=task-runner.js.map