import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AdapterExecuteParams, AdapterResult, OpenCodeAdapterOptions } from '../types.js'

const execFileAsync = promisify(execFile)

// ─── JSON event parser ────────────────────────────────────────────────────────

interface UsageAccum {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

function processJsonLine(line: string, teeStream: NodeJS.WritableStream, usage: UsageAccum, outputParts: string[]): void {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(line) as Record<string, unknown>
  } catch {
    // Not JSON — display as-is (e.g. opencode startup messages)
    teeStream.write(line + '\n')
    return
  }

  const type = event['type'] as string | undefined

  const part = event['part'] as Record<string, unknown> | undefined

  switch (type) {
    // opencode native events
    case 'text': {
      const text = (part?.['text'] ?? event['text']) as string | undefined
      if (text) { teeStream.write(text); outputParts.push(text) }
      break
    }

    case 'tool_use': {
      const name = (part?.['tool'] ?? part?.['name'] ?? event['toolName']) as string | undefined
      if (name) teeStream.write(`\n  [tool: ${name}]\n`)
      break
    }

    case 'step_start':
    case 'step_finish':
      break

    // legacy / SDK events
    case 'text-delta': {
      const text = (event['text'] ?? event['textDelta']) as string | undefined
      if (text) { teeStream.write(text); outputParts.push(text) }
      break
    }

    case 'tool-call': {
      const name = event['toolName'] ?? event['name']
      if (name) teeStream.write(`\n  [tool: ${name}]\n`)
      break
    }

    case 'reasoning-delta':
    case 'tool-result':
    case 'step-start':
    case 'step-finish':
    case 'tool-input-start':
    case 'tool-input-delta':
    case 'text-start':
    case 'text-end':
    case 'raw':
      break

    case 'message_start': {
      const msg = event['message'] as Record<string, unknown> | undefined
      const u = msg?.['usage'] as Record<string, unknown> | undefined
      if (u) usage.inputTokens += (u['input_tokens'] as number) ?? 0
      break
    }

    case 'message_delta': {
      const u = event['usage'] as Record<string, unknown> | undefined
      if (u) usage.outputTokens += (u['output_tokens'] as number) ?? 0
      const cost = event['cost'] as number | undefined
      if (cost) usage.costUsd += cost
      break
    }

    case 'message_stop':
    case 'message-start':
      break

    default: {
      const u = event['usage'] as Record<string, unknown> | undefined
      if (u) {
        usage.inputTokens += (u['input_tokens'] as number) ?? 0
        usage.outputTokens += (u['output_tokens'] as number) ?? 0
      }
      const cost = event['cost'] as number | undefined
      if (cost) usage.costUsd += cost
      break
    }
  }
}

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

      const usage: UsageAccum = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
      const outputParts: string[] = []
      let lineBuffer = ''

      child.stdout.on('data', (chunk: Buffer) => {
        const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        fullLogStream?.write(raw)

        lineBuffer += raw.toString('utf-8')
        const lines = lineBuffer.split('\n')
        lineBuffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) processJsonLine(line, teeStream, usage, outputParts)
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
        if (lineBuffer.trim()) processJsonLine(lineBuffer, teeStream, usage, outputParts)

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
