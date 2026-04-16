#!/usr/bin/env node
import { program } from 'commander';
import { runCommand } from './commands/run.js';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { resetCommand } from './commands/reset.js';
import { logsCommand } from './commands/logs.js';
import { validateCommand } from './commands/validate.js';
import { daemonCommand } from './commands/daemon.js';
import { registerCommand } from './commands/register.js';
import { scheduleCommand } from './commands/schedule.js';
import { addCommand } from './commands/add.js';
import { queueListCommand, queueAddCommand } from './commands/queue.js';
import { docsCommand } from './commands/docs.js';
program
    .name('orc-lite')
    .description('Lightweight orchestrator for autonomous task execution with built-in scheduler')
    .version('0.1.0');
// ─── run ─────────────────────────────────────────────────────────────────────
program
    .command('run [queue]')
    .description('Run a queue (first pending if no number given)')
    .option('-c, --config <path>', 'path to config file')
    .option('--dry-run', 'preview tasks without running them')
    .option('--all', 'run all pending queues sequentially')
    .action((queue, options) => {
    void runCommand(queue, options);
});
// ─── init ────────────────────────────────────────────────────────────────────
program
    .command('init')
    .description('Initialize orc-lite.config.json for this project')
    .action(() => {
    void initCommand();
});
// ─── status ──────────────────────────────────────────────────────────────────
program
    .command('status')
    .description('Show queue and task status')
    .option('-c, --config <path>', 'path to config file')
    .option('-w, --watch [seconds]', 'auto-refresh every N seconds (default: 2)', (v) => parseInt(v, 10) || 2)
    .action((options) => {
    statusCommand(options);
});
// ─── reset ───────────────────────────────────────────────────────────────────
program
    .command('reset <task-file>')
    .description('Reset a task back to pending')
    .option('-c, --config <path>', 'path to config file')
    .option('-q, --queue <number>', 'queue number to search in')
    .action((taskFile, options) => {
    resetCommand(taskFile, options);
});
// ─── logs ────────────────────────────────────────────────────────────────────
program
    .command('logs [task]')
    .description('View task logs (list all if no task given)')
    .option('-c, --config <path>', 'path to config file')
    .option('-f, --tail', 'follow log output')
    .action((task, options) => {
    logsCommand(task, options);
});
// ─── validate ────────────────────────────────────────────────────────────────
program
    .command('validate')
    .description('Validate config and environment')
    .option('-c, --config <path>', 'path to config file')
    .action((options) => {
    void validateCommand(options);
});
// ─── daemon ──────────────────────────────────────────────────────────────────
program
    .command('daemon')
    .description('Start background scheduler daemon')
    .option('-c, --config <path>', 'path to config file (used for daemon settings)')
    .option('-s, --status', 'show daemon status and scheduled jobs')
    .option('--stop', 'stop the running daemon')
    .action((options) => {
    void daemonCommand(options);
});
// ─── register ────────────────────────────────────────────────────────────────
program
    .command('register')
    .description('Register queues with schedule into the global scheduler')
    .option('-c, --config <path>', 'path to config file')
    .action((options) => {
    void registerCommand(options);
});
// ─── schedule ────────────────────────────────────────────────────────────────
program
    .command('schedule [queue] [time]')
    .description('Set or manage queue schedule (e.g. "2:30", "2026-04-09 14:00")')
    .option('-c, --config <path>', 'path to config file')
    .option('-l, --list', 'list all scheduled jobs (all repos)')
    .option('--cancel [id]', 'cancel job(s) for this repo (or specific job by ID)')
    .action((queue, time, options) => {
    void scheduleCommand(queue, time, options);
});
// ─── add ─────────────────────────────────────────────────────────────────────
program
    .command('add [file]')
    .description('Add a task to a queue (interactive if no file given)')
    .option('-c, --config <path>', 'path to config file')
    .option('-q, --queue <name|number>', 'queue name or number (default: first pending)')
    .action((file, options) => {
    void addCommand(file, options);
});
// ─── queue ────────────────────────────────────────────────────────────────────
const queueCmd = program
    .command('queue')
    .description('Manage queues');
queueCmd
    .command('list')
    .description('List all queues')
    .option('-c, --config <path>', 'path to config file')
    .action((options) => {
    queueListCommand(options);
});
queueCmd
    .command('add [name]')
    .description('Add a new queue (interactive if no name given)')
    .option('-c, --config <path>', 'path to config file')
    .option('--dir <path>', 'tasks directory for this queue')
    .option('--schedule <time>', 'schedule (e.g. "2:30")')
    .action((name, options) => {
    void queueAddCommand(name, options);
});
// ─── docs ─────────────────────────────────────────────────────────────────────
program
    .command('docs')
    .description('Generate .orc-lite.md reference file in the current directory')
    .option('-o, --output <path>', 'output file path', '.orc-lite.md')
    .option('-f, --force', 'overwrite if file already exists')
    .action((options) => {
    docsCommand(options);
});
program.parse();
//# sourceMappingURL=index.js.map