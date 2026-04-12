import { runQueue, runAllQueues } from '../core/orchestrator.js';
export async function runCommand(queueArg, options) {
    try {
        if (options.all) {
            await runAllQueues({
                configPath: options.config,
                dryRun: options.dryRun,
            });
            return;
        }
        let queueIndex;
        if (queueArg !== undefined) {
            const n = parseInt(queueArg, 10);
            if (isNaN(n) || n < 1) {
                console.error(`Error: queue number must be a positive integer, got: ${queueArg}`);
                process.exit(1);
            }
            queueIndex = n - 1; // convert 1-based to 0-based
        }
        const result = await runQueue({
            configPath: options.config,
            queueIndex,
            dryRun: options.dryRun,
        });
        if (result.stoppedReason) {
            process.exit(1);
        }
    }
    catch (err) {
        console.error(`\nError: ${err.message}`);
        process.exit(1);
    }
}
//# sourceMappingURL=run.js.map