import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
function processJsonLine(line, teeStream, usage) {
    let event;
    try {
        event = JSON.parse(line);
    }
    catch {
        // Not JSON — display as-is (e.g. opencode startup messages)
        teeStream.write(line + '\n');
        return;
    }
    const type = event['type'];
    switch (type) {
        case 'text-delta': {
            const text = (event['text'] ?? event['textDelta']);
            if (text)
                teeStream.write(text);
            break;
        }
        case 'reasoning-delta': {
            // skip thinking blocks in terminal
            break;
        }
        case 'tool-call': {
            const name = event['toolName'] ?? event['name'];
            if (name)
                teeStream.write(`\n  [tool: ${name}]\n`);
            break;
        }
        case 'tool-result': {
            // skip verbose tool results in terminal
            break;
        }
        case 'step-start':
        case 'step-finish':
        case 'tool-input-start':
        case 'tool-input-delta':
        case 'text-start':
        case 'text-end':
        case 'raw':
            break;
        case 'message_start': {
            const msg = event['message'];
            const u = msg?.['usage'];
            if (u)
                usage.inputTokens += u['input_tokens'] ?? 0;
            break;
        }
        case 'message_delta': {
            const u = event['usage'];
            if (u)
                usage.outputTokens += u['output_tokens'] ?? 0;
            const cost = event['cost'];
            if (cost)
                usage.costUsd += cost;
            break;
        }
        case 'message_stop':
        case 'message-start':
            break;
        default: {
            // Unknown event — check if it has a cost/usage field we should capture
            const u = event['usage'];
            if (u) {
                usage.inputTokens += u['input_tokens'] ?? 0;
                usage.outputTokens += u['output_tokens'] ?? 0;
            }
            const cost = event['cost'];
            if (cost)
                usage.costUsd += cost;
            break;
        }
    }
}
// ─── Adapter ──────────────────────────────────────────────────────────────────
export class OpenCodeAdapter {
    options;
    name = 'opencode';
    constructor(options) {
        this.options = options;
    }
    async isInstalled() {
        try {
            await execFileAsync('which', ['opencode']);
            return true;
        }
        catch {
            return false;
        }
    }
    async execute(params) {
        const { prompt, workingDir, timeout, teeStream, fullLogStream } = params;
        const startTime = Date.now();
        return new Promise((resolve) => {
            const env = this.options.insecure_tls
                ? { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
                : process.env;
            const child = spawn('opencode', ['run', '--format', 'json', prompt], {
                cwd: workingDir,
                stdio: ['inherit', 'pipe', 'pipe'],
                env,
            });
            const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
            let lineBuffer = '';
            child.stdout.on('data', (chunk) => {
                const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                fullLogStream?.write(raw);
                lineBuffer += raw.toString('utf-8');
                const lines = lineBuffer.split('\n');
                lineBuffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (line.trim())
                        processJsonLine(line, teeStream, usage);
                }
            });
            child.stderr.on('data', (chunk) => {
                teeStream.write(chunk);
                fullLogStream?.write(chunk);
            });
            let killed = false;
            const timer = setTimeout(() => {
                killed = true;
                child.kill('SIGTERM');
                setTimeout(() => child.kill('SIGKILL'), 5000);
            }, timeout * 1000);
            child.on('close', (code) => {
                clearTimeout(timer);
                if (lineBuffer.trim())
                    processJsonLine(lineBuffer, teeStream, usage);
                const durationMs = Date.now() - startTime;
                const exitCode = killed ? 124 : (code ?? 1);
                const totalTokens = usage.inputTokens + usage.outputTokens;
                resolve({
                    exitCode,
                    success: exitCode === 0,
                    durationMs,
                    tokensUsed: totalTokens || undefined,
                    costUsd: usage.costUsd || undefined,
                });
            });
        });
    }
}
export function createAdapter(options) {
    return new OpenCodeAdapter(options);
}
//# sourceMappingURL=opencode-adapter.js.map