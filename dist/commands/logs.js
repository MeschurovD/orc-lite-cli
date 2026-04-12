import { createReadStream, existsSync, readdirSync, readFileSync, statSync, watch, } from 'node:fs';
import { resolve, join } from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
export function logsCommand(taskArg, options) {
    try {
        const cwd = process.cwd();
        const { config } = loadConfig(options.config);
        const logsDir = resolve(cwd, config.logs_dir);
        if (!taskArg) {
            listLogs(logsDir);
            return;
        }
        const logPath = resolveLogPath(logsDir, taskArg);
        if (!logPath) {
            console.error(`Log file not found for: ${taskArg}`);
            process.exit(1);
        }
        if (options.tail) {
            tailLog(logPath);
        }
        else {
            printLog(logPath);
        }
    }
    catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
function listLogs(logsDir) {
    if (!existsSync(logsDir)) {
        console.log(chalk.dim('No logs directory found.'));
        return;
    }
    const files = readdirSync(logsDir)
        .filter((f) => f.endsWith('.log'))
        .map((f) => {
        const stat = statSync(join(logsDir, f));
        return { name: f, size: stat.size, mtime: stat.mtime };
    })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    if (files.length === 0) {
        console.log(chalk.dim('No log files found.'));
        return;
    }
    console.log();
    console.log(chalk.bold(`Task logs — ${logsDir}`));
    console.log();
    for (const f of files) {
        const name = f.name.padEnd(45);
        const size = formatSize(f.size).padStart(8);
        const date = f.mtime.toISOString().slice(0, 19).replace('T', ' ');
        console.log(`  ${chalk.cyan(name)} ${chalk.dim(size)}  ${chalk.dim(date)}`);
    }
    console.log();
}
function resolveLogPath(logsDir, taskArg) {
    const candidates = [
        join(logsDir, taskArg),
        join(logsDir, `${taskArg}.log`),
        join(logsDir, `${taskArg.replace(/\.md$/i, '')}.log`),
    ];
    for (const p of candidates) {
        if (existsSync(p))
            return p;
    }
    return null;
}
function printLog(logPath) {
    const content = readFileSync(logPath, 'utf-8');
    process.stdout.write(content);
}
function tailLog(logPath) {
    printLog(logPath);
    let position = statSync(logPath).size;
    console.log(chalk.dim(`\n--- following ${logPath} (Ctrl+C to stop) ---\n`));
    const watcher = watch(logPath, () => {
        const newSize = statSync(logPath).size;
        if (newSize <= position)
            return;
        const stream = createReadStream(logPath, { start: position, end: newSize - 1 });
        stream.on('data', (chunk) => process.stdout.write(chunk));
        stream.on('end', () => { position = newSize; });
    });
    process.on('SIGINT', () => {
        watcher.close();
        process.exit(0);
    });
}
function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}
//# sourceMappingURL=logs.js.map