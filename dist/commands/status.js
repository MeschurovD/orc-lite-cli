import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
const TASK_STATUS_COLORS = {
    pending: chalk.dim,
    in_progress: chalk.yellow,
    done: chalk.green,
    failed: chalk.red,
    conflict: chalk.magenta,
    skipped: chalk.yellow,
};
const TASK_STATUS_ICONS = {
    pending: '○',
    in_progress: '◑',
    done: '●',
    failed: '✗',
    conflict: '⚡',
    skipped: '⊘',
};
const QUEUE_STATUS_COLORS = {
    pending: chalk.dim,
    in_progress: chalk.yellow,
    done: chalk.green,
    failed: chalk.red,
};
export function statusCommand(options) {
    try {
        const { config } = loadConfig(options.config);
        const queues = config.queues;
        const totalTasks = queues.reduce((s, q) => s + q.tasks.length, 0);
        const doneTasks = queues.reduce((s, q) => s + q.tasks.filter((t) => t.status === 'done').length, 0);
        console.log();
        console.log(chalk.bold(`orc-lite status — ${doneTasks}/${totalTasks} tasks done`));
        console.log(chalk.dim(`target branch: ${config.target_branch}`));
        console.log();
        for (let qi = 0; qi < queues.length; qi++) {
            const queue = queues[qi];
            const qDone = queue.tasks.filter((t) => t.status === 'done').length;
            const qTotal = queue.tasks.length;
            const queueColor = QUEUE_STATUS_COLORS[queue.status];
            const queueLabel = queue.name ?? `queue-${qi + 1}`;
            console.log(`  ${chalk.bold(`[${qi + 1}] ${queueLabel}`)}` +
                ` ${queueColor(`(${queue.status})`)}` +
                chalk.dim(` ${qDone}/${qTotal}`) +
                (queue.schedule ? chalk.dim(` @ ${queue.schedule}`) : ''));
            for (let ti = 0; ti < queue.tasks.length; ti++) {
                const task = queue.tasks[ti];
                const color = TASK_STATUS_COLORS[task.status];
                const icon = TASK_STATUS_ICONS[task.status];
                const index = chalk.dim(`${String(ti + 1).padStart(3)}.`);
                const name = task.file.padEnd(42);
                const status = color(`${icon} ${task.status}`);
                let line = `       ${index} ${name} ${status}`;
                if (task.started_at && task.completed_at) {
                    const startMs = new Date(task.started_at).getTime();
                    const endMs = new Date(task.completed_at).getTime();
                    const secs = Math.round((endMs - startMs) / 1000);
                    line += chalk.dim(`  (${secs}s)`);
                }
                console.log(line);
                if (task.error) {
                    console.log(chalk.red(`            └─ ${task.error}`));
                }
                if (task.tokens_used) {
                    const costPart = task.cost_usd ? ` / ~$${task.cost_usd.toFixed(4)}` : '';
                    console.log(chalk.dim(`            └─ tokens: ${task.tokens_used}${costPart}`));
                }
            }
            console.log();
        }
        // Total cost summary
        const allTasks = queues.flatMap((q) => q.tasks);
        const tasksWithCost = allTasks.filter((t) => t.tokens_used);
        if (tasksWithCost.length > 0) {
            const totalTokens = tasksWithCost.reduce((s, t) => s + (t.tokens_used ?? 0), 0);
            const totalCost = tasksWithCost.reduce((s, t) => s + (t.cost_usd ?? 0), 0);
            const costStr = totalCost > 0 ? ` / ~$${totalCost.toFixed(4)}` : '';
            console.log(chalk.dim(`Total tokens: ${totalTokens}${costStr}`));
            console.log();
        }
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
//# sourceMappingURL=status.js.map