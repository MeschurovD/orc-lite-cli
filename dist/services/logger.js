import { createWriteStream, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PassThrough } from 'node:stream';
import chalk from 'chalk';
// ─── Capture stream ───────────────────────────────────────────────────────────
export function createCaptureStream() {
    const chunks = [];
    const stream = new PassThrough();
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    return {
        stream,
        getOutput: () => Buffer.concat(chunks).toString('utf-8'),
    };
}
const BOX_WIDTH = 60;
function timestamp() {
    return new Date().toTimeString().slice(0, 8);
}
function boxTop() {
    return chalk.dim('┌─ opencode ' + '─'.repeat(BOX_WIDTH - 12) + '┐');
}
function boxBottom() {
    return chalk.dim('└' + '─'.repeat(BOX_WIDTH - 1) + '┘');
}
// ─── Pipeline logger (no file) ───────────────────────────────────────────────
export const pipelineLogger = {
    info(msg) {
        console.log(`${chalk.dim(`[${timestamp()}]`)} ${msg}`);
    },
    success(msg) {
        console.log(`${chalk.dim(`[${timestamp()}]`)} ${chalk.green('✓')} ${msg}`);
    },
    error(msg) {
        console.error(`${chalk.dim(`[${timestamp()}]`)} ${chalk.red('✗')} ${msg}`);
    },
    separator() {
        console.log(chalk.dim('─'.repeat(BOX_WIDTH)));
    },
};
export function createTaskLogger(taskName, logsDir) {
    mkdirSync(logsDir, { recursive: true });
    const logPath = join(logsDir, `${taskName}.log`);
    const fileStream = createWriteStream(logPath, { flags: 'a' });
    function writeFile(msg) {
        fileStream.write(msg + '\n');
    }
    function writeConsole(msg) {
        process.stdout.write(msg + '\n');
    }
    const tee = new PassThrough();
    tee.on('data', (chunk) => {
        process.stdout.write(chunk);
    });
    writeFile(`\n${'='.repeat(BOX_WIDTH)}`);
    writeFile(`Task: ${taskName}`);
    writeFile(`Started: ${new Date().toISOString()}`);
    writeFile('='.repeat(BOX_WIDTH));
    return {
        step(msg) {
            const line = `  ${chalk.cyan('→')} ${msg}`;
            writeConsole(line);
            writeFile(`  → ${msg}`);
        },
        success(msg) {
            const line = `  ${chalk.green('✓')} ${msg}`;
            writeConsole(line);
            writeFile(`  ✓ ${msg}`);
        },
        error(msg) {
            const line = `  ${chalk.red('✗')} ${msg}`;
            writeConsole(line);
            writeFile(`  ✗ ${msg}`);
        },
        raw(msg) {
            writeConsole(msg);
            writeFile(msg);
        },
        openCodexFrame() {
            writeConsole(boxTop());
            writeFile(`--- opencode output ---`);
        },
        closeCodexFrame() {
            writeConsole(boxBottom());
            writeFile(`--- end opencode output ---`);
        },
        fileStream,
        teeStream: tee,
        close() {
            tee.end();
            fileStream.end();
        },
    };
}
// ─── File logger (for daemon) ─────────────────────────────────────────────────
export function createFileLogger(logFile) {
    mkdirSync(dirname(logFile), { recursive: true });
    const stream = createWriteStream(logFile, { flags: 'a' });
    function write(level, msg) {
        const ts = new Date().toISOString();
        stream.write(`[${ts}] [${level}] ${msg}\n`);
    }
    return {
        info(msg) { write('INFO', msg); },
        error(msg) { write('ERROR', msg); },
        close() { stream.end(); },
    };
}
//# sourceMappingURL=logger.js.map