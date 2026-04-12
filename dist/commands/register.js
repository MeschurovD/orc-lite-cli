import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { parseScheduleTime, formatScheduleTime, registerJob, loadRegistry, saveRegistry, getSchedulerPath, isDaemonRunning, getDaemonPid, } from '../core/scheduler.js';
export async function registerCommand(options) {
    const cwd = process.cwd();
    let config;
    let configPath;
    try {
        const result = loadConfig(options.config);
        config = result.config;
        configPath = result.path;
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    }
    const repoPath = resolve(cwd);
    let registered = 0;
    let skipped = 0;
    let warnings = 0;
    console.log();
    for (let i = 0; i < config.queues.length; i++) {
        const queue = config.queues[i];
        const label = queue.name ?? `#${i + 1}`;
        if (!queue.schedule)
            continue;
        if (queue.status === 'done') {
            console.log(chalk.dim(`  queue ${label}: skipped (already done)`));
            skipped++;
            continue;
        }
        let scheduledAt;
        try {
            scheduledAt = parseScheduleTime(queue.schedule);
        }
        catch (err) {
            console.log(chalk.yellow(`  queue ${label}: ${err.message}`));
            warnings++;
            continue;
        }
        if (scheduledAt < new Date()) {
            console.log(chalk.yellow(`  queue ${label}: schedule "${queue.schedule}" is in the past — skipping`));
            warnings++;
            continue;
        }
        const job = registerJob({
            repo: repoPath,
            config: options.config ? resolve(options.config) : undefined,
            queueIndex: i,
            queueName: queue.name,
            scheduledAt,
        });
        console.log(chalk.green('  ✓') +
            ` queue ${chalk.bold(label)}` +
            ` [${job.id}]` +
            chalk.dim(` → ${formatScheduleTime(scheduledAt)}`));
        registered++;
    }
    // Remove jobs for queues that no longer have a schedule or are done
    const registry = loadRegistry();
    let removed = 0;
    registry.jobs = registry.jobs.filter((job) => {
        if (job.repo !== repoPath)
            return true;
        if (job.status !== 'scheduled')
            return true;
        const queue = config.queues[job.queue_index];
        if (!queue) {
            removed++;
            return false;
        }
        if (!queue.schedule || queue.status === 'done') {
            removed++;
            return false;
        }
        return true;
    });
    if (removed > 0) {
        saveRegistry(registry);
        console.log(chalk.dim(`  Removed ${removed} stale job(s)`));
    }
    console.log();
    if (registered === 0 && warnings === 0) {
        console.log(chalk.dim('No queues with schedule found.'));
        console.log(chalk.dim(`Add "schedule" field to queues in ${configPath}`));
    }
    else {
        const parts = [];
        if (registered > 0)
            parts.push(chalk.green(`${registered} registered`));
        if (skipped > 0)
            parts.push(chalk.dim(`${skipped} skipped`));
        if (warnings > 0)
            parts.push(chalk.yellow(`${warnings} warnings`));
        console.log(parts.join('  '));
        console.log(chalk.dim(`Run ${chalk.white('orc-lite schedule --list')} to see all jobs`));
        if (registered > 0) {
            console.log();
            await ensureDaemon();
        }
    }
    console.log();
    console.log(chalk.dim(`Scheduler: ${getSchedulerPath()}`));
    console.log();
}
// ─── Daemon auto-start ────────────────────────────────────────────────────────
async function ensureDaemon() {
    if (isDaemonRunning()) {
        const pid = getDaemonPid();
        console.log(chalk.dim(`  Daemon already running (PID ${pid}) — will pick up jobs on next poll`));
        return;
    }
    const child = spawn(process.execPath, [process.argv[1], 'daemon'], {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();
    await new Promise((r) => setTimeout(r, 400));
    const pid = getDaemonPid();
    if (pid) {
        console.log(chalk.green('✓') + ` Daemon started in background (PID ${pid})`);
    }
    else {
        console.log(chalk.yellow('  Could not verify daemon started — run `orc-lite daemon` manually if needed'));
    }
}
//# sourceMappingURL=register.js.map