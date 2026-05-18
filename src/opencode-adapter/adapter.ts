import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { processOpenCodeJsonLine } from './events.js'
import type {
  AdapterExecuteParams,
  AdapterResult,
  OpenCodeAdapterOptions,
  OpenCodeDisplayState,
  OpenCodeUsage,
} from './types.js'

const execFileAsync = promisify(execFile)

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class OpenCodeAdapter {
  readonly name = 'opencode'

  constructor(private options: OpenCodeAdapterOptions) {}

  async isInstalled(): Promise<boolean> {
    try {
      await execFileAsync('which', ['opencode'])
      return true
    } catch {
      return false
    }
  }

  async execute(params: AdapterExecuteParams): Promise<AdapterResult> {
    const { prompt, workingDir, timeout, teeStream, fullLogStream } = params
    const startTime = Date.now()

    return new Promise((resolve) => {
      const env = this.options.insecure_tls
        ? { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
        : process.env

      const child = spawn('opencode', ['run', '--format', 'json', prompt], {
        cwd: workingDir,
        stdio: ['inherit', 'pipe', 'pipe'],
        env,
      })

      const usage: OpenCodeUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
      const outputParts: string[] = []
      const displayState: OpenCodeDisplayState = { atLineStart: true }
      let lineBuffer = ''

      child.stdout.on('data', (chunk: Buffer) => {
        const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        fullLogStream?.write(raw)

        lineBuffer += raw.toString('utf-8')
        const lines = lineBuffer.split('\n')
        lineBuffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) processOpenCodeJsonLine(line, teeStream, usage, outputParts, displayState)
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        teeStream.write(chunk)
        fullLogStream?.write(chunk)
      })

      let killed = false
      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 5000)
      }, timeout * 1000)

      child.on('close', (code) => {
        clearTimeout(timer)
        if (lineBuffer.trim()) processOpenCodeJsonLine(lineBuffer, teeStream, usage, outputParts, displayState)

        const durationMs = Date.now() - startTime
        const exitCode = killed ? 124 : (code ?? 1)
        const totalTokens = usage.inputTokens + usage.outputTokens

        resolve({
          exitCode,
          success: exitCode === 0,
          durationMs,
          tokensUsed: totalTokens || undefined,
          costUsd: usage.costUsd || undefined,
          output: outputParts.join(''),
        })
      })
    })
  }
}

export function createAdapter(options: OpenCodeAdapterOptions): OpenCodeAdapter {
  return new OpenCodeAdapter(options)
}
