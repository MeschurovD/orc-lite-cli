import chalk from 'chalk';
import { loadConfig, updateTaskStatus } from '../core/config.js';
export function resetCommand(taskFile, options) {
    try {
        const { config, path: configPath } = loadConfig(options.config);
        // Find the task across queues
        let foundQueueIndex = -1;
        let foundTaskIndex = -1;
        // If queue number specified, search only that queue
        if (options.queue !== undefined) {
            const qn = parseInt(options.queue, 10);
            if (isNaN(qn) || qn < 1) {
                console.error(chalk.red(`Invalid queue number: ${options.queue}`));
                process.exit(1);
            }
            const qi = qn - 1;
            if (qi >= config.queues.length) {
                console.error(chalk.red(`Queue #${qn} not found (${config.queues.length} queues total)`));
                process.exit(1);
            }
            const ti = config.queues[qi].tasks.findIndex((t) => t.file === taskFile);
            if (ti !== -1) {
                foundQueueIndex = qi;
                foundTaskIndex = ti;
            }
        }
        else {
            // Search all queues
            for (let qi = 0; qi < config.queues.length; qi++) {
                const ti = config.queues[qi].tasks.findIndex((t) => t.file === taskFile);
                if (ti !== -1) {
                    foundQueueIndex = qi;
                    foundTaskIndex = ti;
                    break;
                }
            }
        }
        if (foundQueueIndex === -1 || foundTaskIndex === -1) {
            console.error(chalk.red(`Task not found: ${taskFile}`));
            process.exit(1);
        }
        const task = config.queues[foundQueueIndex].tasks[foundTaskIndex];
        if (task.status === 'done') {
            console.error(chalk.yellow(`Task "${taskFile}" is already done. Edit ${configPath} manually if needed.`));
            process.exit(1);
        }
        updateTaskStatus(configPath, foundQueueIndex, foundTaskIndex, {
            status: 'pending',
            error: undefined,
            started_at: undefined,
            completed_at: undefined,
            retry_count: undefined,
        });
        const queueLabel = config.queues[foundQueueIndex].name ?? `#${foundQueueIndex + 1}`;
        console.log(chalk.green(`✓ Task "${taskFile}" reset to pending (queue: ${queueLabel})`));
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
//# sourceMappingURL=reset.js.map