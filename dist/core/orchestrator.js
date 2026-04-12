import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve, relative, basename } from 'node:path';
import { loadConfig, getTaskBranchName, updateTaskStatus, updateQueueStatus } from './config.js';
import { GitService } from '../services/git.js';
import { pipelineLogger } from '../services/logger.js';
import { createNotifier } from '../services/notifier.js';
import { buildPrompt } from '../adapters/prompt-builder.js';
import { createAdapter } from '../adapters/opencode-adapter.js';
import { runTask } from './task-runner.js';
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
export class DirtyWorkingTreeError extends Error {
    files;
    constructor(files) {
        const fileList = files.map((f) => `  - ${f}`).join('\n');
        super(`Working tree has uncommitted changes:\n${fileList}\nPlease commit or stash them before running orc-lite.`);
        this.files = files;
        this.name = 'DirtyWorkingTreeError';
    }
}
export async function runQueue(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const { config, path: resolvedConfigPath } = loadConfig(options.configPath);
    // ── Pre-flight checks ──────────────────────────────────────────────────────
    pipelineLogger.info(options.dryRun ? 'orc-lite DRY RUN' : 'orc-lite starting');
    pipelineLogger.info(`config: ${resolvedConfigPath}`);
    const git = new GitService(cwd);
    await git.ensureGitRepo();
    if (!options.dryRun && config.git_strategy !== 'none') {
        await checkAndHandleDirtyTree(git, cwd, resolvedConfigPath, config);
    }
    if (config.git_strategy === 'branch') {
        await git.ensureBranchExists(config.target_branch);
    }
    if (!options.dryRun) {
        const adapter = createAdapter(config.adapter_options);
        if (!(await adapter.isInstalled())) {
            throw new Error('opencode CLI is not installed or not in PATH.');
        }
    }
    // ── Select queue ───────────────────────────────────────────────────────────
    let queueIdx;
    if (options.queueIndex !== undefined) {
        queueIdx = options.queueIndex;
        if (queueIdx < 0 || queueIdx >= config.queues.length) {
            throw new Error(`Queue index ${queueIdx} out of range (${config.queues.length} queues)`);
        }
    }
    else {
        queueIdx = config.queues.findIndex((q) => q.status !== 'done');
        if (queueIdx === -1) {
            pipelineLogger.success('All queues are already done!');
            return { totalTasks: 0, doneTasks: 0 };
        }
    }
    const queue = config.queues[queueIdx];
    const queueLabel = queue.name ? `"${queue.name}"` : `#${queueIdx + 1}`;
    pipelineLogger.info(`queue: ${queueLabel}`);
    const total = queue.tasks.length;
    const pending = queue.tasks.filter((t) => t.status === 'pending').length;
    const done = queue.tasks.filter((t) => t.status === 'done').length;
    pipelineLogger.info(`tasks: ${total} total, ${done} done, ${pending} pending`);
    if (config.push !== 'none')
        pipelineLogger.info(`push mode: ${config.push}`);
    if (config.max_retries > 0)
        pipelineLogger.info(`max retries: ${config.max_retries}`);
    const projectName = config.project_name ?? basename(cwd);
    const notifier = createNotifier(config.notifications);
    if (config.notifications) {
        pipelineLogger.info(`notifications: ${config.notifications.on.join(', ')}`);
        if (notifier) {
            const pi = notifier.proxyInfo;
            if (pi.active) {
                pipelineLogger.info(`notifications proxy: ${pi.url} (source: ${pi.source})`);
            }
            else {
                pipelineLogger.info('notifications proxy: none (direct connection)');
            }
        }
    }
    pipelineLogger.separator();
    if (pending === 0 && queue.status === 'done') {
        pipelineLogger.success(`Queue ${queueLabel} is already done!`);
        return { totalTasks: total, doneTasks: done };
    }
    if (pending === 0 && done === total) {
        // All tasks done but queue status not updated — fix it
        updateQueueStatus(resolvedConfigPath, queueIdx, 'done');
        pipelineLogger.success(`Queue ${queueLabel} is already done!`);
        return { totalTasks: total, doneTasks: done };
    }
    // ── Dry run ────────────────────────────────────────────────────────────────
    if (options.dryRun) {
        return runDryRun(config, queue, queueIdx, cwd, total, done, pending);
    }
    // Check if queue is blocked
    const blockedTask = queue.tasks.find((t) => t.status === 'failed' || t.status === 'conflict');
    if (blockedTask) {
        throw new Error(`Queue ${queueLabel} is blocked at task "${blockedTask.file}" (status: ${blockedTask.status}).\n` +
            `Fix the issue and reset it with: orc-lite reset ${blockedTask.file}`);
    }
    // Reset stale in_progress tasks
    for (let i = 0; i < queue.tasks.length; i++) {
        if (queue.tasks[i].status === 'in_progress') {
            pipelineLogger.info(`Resetting stale in_progress task: ${queue.tasks[i].file}`);
            updateTaskStatus(resolvedConfigPath, queueIdx, i, { status: 'pending' });
        }
    }
    // ── Signal handling ────────────────────────────────────────────────────────
    let currentTaskIndex = -1;
    const signalHandler = async (sig) => {
        const exitCode = sig === 'SIGINT' ? 130 : 143;
        pipelineLogger.error(`\nReceived ${sig} — shutting down`);
        if (currentTaskIndex >= 0) {
            try {
                updateTaskStatus(resolvedConfigPath, queueIdx, currentTaskIndex, {
                    status: 'failed',
                    completed_at: new Date().toISOString(),
                    error: `interrupted by ${sig}`,
                });
            }
            catch { /* best effort */ }
            if (config.git_strategy === 'branch') {
                try {
                    await git.checkoutBranch(config.target_branch);
                }
                catch { /* best effort */ }
            }
            const doneCount = queue.tasks.filter((t) => t.status === 'done').length;
            notifier?.notify('pipeline_failed', {
                totalTasks: total,
                doneTasks: doneCount,
                error: `interrupted by ${sig}`,
                projectName,
                queueName: queue.name,
            }).catch(() => { });
            await new Promise((r) => setTimeout(r, 500));
        }
        process.exit(exitCode);
    };
    const sigintHandler = () => { void signalHandler('SIGINT'); };
    const sigtermHandler = () => { void signalHandler('SIGTERM'); };
    process.once('SIGINT', sigintHandler);
    process.once('SIGTERM', sigtermHandler);
    let aborted = false;
    const onAbort = () => { aborted = true; };
    options.signal?.addEventListener('abort', onAbort);
    // ── Mark queue in progress ─────────────────────────────────────────────────
    updateQueueStatus(resolvedConfigPath, queueIdx, 'in_progress');
    // ── Main loop ──────────────────────────────────────────────────────────────
    const startTime = Date.now();
    let doneCount = done;
    let totalTokensUsed = 0;
    let totalCostUsd = 0;
    try {
        for (let i = 0; i < queue.tasks.length; i++) {
            if (aborted) {
                pipelineLogger.error('Queue stopped by abort signal');
                break;
            }
            // Re-read config each iteration
            const { config: freshConfig } = loadConfig(resolvedConfigPath);
            const freshQueue = freshConfig.queues[queueIdx];
            const task = freshQueue.tasks[i];
            if (task.status === 'done')
                continue;
            if (task.status !== 'pending')
                continue;
            currentTaskIndex = i;
            const result = await runTask(task, i, queueIdx, freshConfig, resolvedConfigPath, cwd, total, notifier, projectName, queue.name);
            currentTaskIndex = -1;
            if (result.tokensUsed)
                totalTokensUsed += result.tokensUsed;
            if (result.costUsd)
                totalCostUsd += result.costUsd;
            if (result.status === 'skipped') {
                pipelineLogger.separator();
                continue;
            }
            if (!result.success) {
                updateQueueStatus(resolvedConfigPath, queueIdx, 'failed');
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                pipelineLogger.separator();
                pipelineLogger.error(`Queue stopped after ${elapsed}s`);
                pipelineLogger.error(`Check logs in ${resolve(cwd, freshConfig.logs_dir)}/`);
                await notifier?.notify('pipeline_failed', {
                    totalTasks: total,
                    doneTasks: doneCount,
                    durationMs: Date.now() - startTime,
                    error: result.error,
                    projectName,
                    queueName: queue.name,
                });
                return {
                    totalTasks: total,
                    doneTasks: doneCount,
                    failedTask: task.file,
                    stoppedReason: result.status === 'conflict' ? 'conflict' : 'failed',
                    totalTokensUsed: totalTokensUsed || undefined,
                    totalCostUsd: totalCostUsd || undefined,
                };
            }
            doneCount++;
            pipelineLogger.separator();
        }
    }
    finally {
        process.removeListener('SIGINT', sigintHandler);
        process.removeListener('SIGTERM', sigtermHandler);
        options.signal?.removeEventListener('abort', onAbort);
    }
    // ── Push at end ─────────────────────────────────────────────────────────────
    if (config.push === 'end' && config.git_strategy !== 'none') {
        const pushBranch = config.git_strategy === 'branch'
            ? config.target_branch
            : await git.getCurrentBranch();
        pipelineLogger.info(`Pushing ${pushBranch} to origin...`);
        try {
            await git.pushBranch(pushBranch);
            pipelineLogger.success('Pushed');
        }
        catch (err) {
            pipelineLogger.error(`Push failed: ${err.message}`);
        }
    }
    // ── Mark queue done ────────────────────────────────────────────────────────
    updateQueueStatus(resolvedConfigPath, queueIdx, 'done');
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    pipelineLogger.success(`Queue ${queueLabel} completed in ${elapsed}s`);
    if (totalTokensUsed > 0) {
        const costStr = totalCostUsd > 0 ? ` (~$${totalCostUsd.toFixed(4)})` : '';
        pipelineLogger.info(`Total tokens used: ${totalTokensUsed}${costStr}`);
    }
    const pipelineDurationMs = Date.now() - startTime;
    await notifier?.notify('pipeline_done', {
        totalTasks: total,
        doneTasks: doneCount,
        durationMs: pipelineDurationMs,
        projectName,
        queueName: queue.name,
    });
    // ── Auto-PR ─────────────────────────────────────────────────────────────────
    if (config.auto_pr?.enabled) {
        await createAutoPr(config.auto_pr, config.target_branch, queue, doneCount, total, cwd);
    }
    return {
        totalTasks: total,
        doneTasks: doneCount,
        totalTokensUsed: totalTokensUsed || undefined,
        totalCostUsd: totalCostUsd || undefined,
    };
}
// ─── Run all pending queues sequentially ──────────────────────────────────────
export async function runAllQueues(options) {
    const { config } = loadConfig(options.configPath);
    for (let i = 0; i < config.queues.length; i++) {
        const queue = config.queues[i];
        if (queue.status === 'done')
            continue;
        pipelineLogger.info(`\nRunning queue ${i + 1}/${config.queues.length}: ${queue.name ?? `#${i + 1}`}`);
        const result = await runQueue({ ...options, queueIndex: i });
        if (result.stoppedReason) {
            pipelineLogger.error(`Queue ${i + 1} failed — stopping`);
            process.exit(1);
        }
    }
    pipelineLogger.success('All queues completed');
}
// ─── Auto-PR ──────────────────────────────────────────────────────────────────
async function createAutoPr(prConfig, targetBranch, queue, completedCount, totalCount, cwd) {
    try {
        await execFileAsync('which', ['gh']);
    }
    catch {
        pipelineLogger.error('auto_pr: gh CLI not found in PATH — skipping PR creation');
        return;
    }
    const baseBranch = prConfig.base_branch ?? targetBranch;
    const titleTemplate = prConfig.title_template ?? 'feat: {{completed_count}} automated tasks';
    const title = titleTemplate
        .replace(/\{\{completed_count\}\}/g, String(completedCount))
        .replace(/\{\{total_count\}\}/g, String(totalCount));
    const doneTasks = queue.tasks.filter((t) => t.status === 'done');
    const taskList = doneTasks.map((t) => `- ${t.file}`).join('\n');
    const body = `## Automated tasks (${completedCount}/${totalCount})\n\n${taskList}\n\n_Generated by orc-lite_`;
    const args = [
        'pr', 'create',
        '--title', title,
        '--body', body,
        '--base', baseBranch,
        '--head', targetBranch,
    ];
    if (prConfig.draft)
        args.push('--draft');
    try {
        pipelineLogger.info(`Creating PR: "${title}"`);
        const { stdout } = await execAsync(`gh ${args.map((a) => JSON.stringify(a)).join(' ')}`, { cwd });
        pipelineLogger.success(`PR created: ${stdout.trim()}`);
    }
    catch (err) {
        pipelineLogger.error(`auto_pr failed: ${err.message}`);
    }
}
// ─── Dry Run ──────────────────────────────────────────────────────────────────
function runDryRun(config, queue, queueIdx, cwd, total, done, pending) {
    const queueLabel = queue.name ?? `#${queueIdx + 1}`;
    pipelineLogger.info(`[DRY RUN] Queue ${queueLabel} preview — ${pending} pending task(s)\n`);
    let taskNum = 0;
    for (let i = 0; i < queue.tasks.length; i++) {
        const task = queue.tasks[i];
        if (task.status === 'done')
            continue;
        if (task.status !== 'pending') {
            console.log(`  ${i + 1}. ${task.file} — ${task.status} (blocked)\n`);
            continue;
        }
        taskNum++;
        const branchName = getTaskBranchName(task);
        const taskFilePath = resolve(cwd, config.tasks_dir, task.file);
        const fileExists = existsSync(taskFilePath);
        console.log(`  ${taskNum}. ${task.file}`);
        if (config.git_strategy === 'branch') {
            console.log(`     Branch: ${branchName}`);
        }
        else {
            console.log(`     Git:    ${config.git_strategy} (no branch)`);
        }
        console.log(`     File:   ${fileExists ? '✓ exists' : '✗ NOT FOUND'}`);
        if (fileExists) {
            try {
                const prompt = buildPrompt({
                    taskFile: task.file,
                    tasksDir: config.tasks_dir,
                    systemPrompt: config.system_prompt,
                    contextFiles: task.context_files,
                    workingDir: cwd,
                });
                console.log(`     Prompt: (${prompt.length} chars) "${prompt.slice(0, 80).replace(/\n/g, ' ')}…"`);
            }
            catch (err) {
                console.log(`     Prompt: ✗ build error: ${err.message}`);
            }
        }
        if (task.context_files?.length) {
            for (const ctxFile of task.context_files) {
                const exists = existsSync(resolve(cwd, ctxFile));
                console.log(`     Context: ${ctxFile} ${exists ? '✓' : '✗ NOT FOUND'}`);
            }
        }
        const stages = task.stages ?? ['implement'];
        console.log(`     Stages:  ${stages.join(' → ')}`);
        const verifyCmd = task.verification_cmd ?? config.verification_cmd;
        if (verifyCmd)
            console.log(`     Verify:  ${verifyCmd}`);
        const preHook = task.hooks?.pre_task ?? config.hooks?.pre_task;
        const postHook = task.hooks?.post_task ?? config.hooks?.post_task;
        if (preHook)
            console.log(`     Pre:     ${preHook}`);
        if (postHook)
            console.log(`     Post:    ${postHook}`);
        const retries = task.max_retries ?? config.max_retries;
        if (retries > 0)
            console.log(`     Retries: ${retries}`);
        console.log();
    }
    console.log('  No changes made.\n');
    return { totalTasks: total, doneTasks: done };
}
// ─── Working tree check ────────────────────────────────────────────────────────
async function checkAndHandleDirtyTree(git, cwd, configPath, config) {
    const status = await git.getStatus();
    if (status.isClean())
        return;
    const configRel = relative(cwd, configPath);
    const tasksPrefix = config.tasks_dir.replace(/\/$/, '') + '/';
    const logsPrefix = config.logs_dir.replace(/\/$/, '') + '/';
    const isOrcManaged = (fp) => fp === configRel ||
        fp.startsWith(tasksPrefix) ||
        fp.startsWith(logsPrefix);
    const allFiles = status.files.map((f) => f.path);
    const nonOrcFiles = allFiles.filter((fp) => !isOrcManaged(fp));
    if (nonOrcFiles.length > 0) {
        throw new DirtyWorkingTreeError(nonOrcFiles);
    }
    pipelineLogger.info(`Auto-committing orc-lite config changes (${allFiles.length} file(s))...`);
    await git.stagePathsAndCommit(allFiles, 'orc-lite: update config');
    pipelineLogger.info('orc-lite config committed');
}
//# sourceMappingURL=orchestrator.js.map