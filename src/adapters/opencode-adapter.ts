import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AdapterExecuteParams, AdapterResult, OpenCodeAdapterOptions } from '../types.js'

const execFileAsync = promisify(execFile)

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
      const child = spawn('opencode', ['-p', prompt], {
        cwd: workingDir,
        stdio: ['inherit', 'pipe', 'pipe'],
        env: process.env,
      })

      const outputChunks: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        teeStream.write(buf)
        fullLogStream?.write(buf)
        outputChunks.push(buf)
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
        const durationMs = Date.now() - startTime
        const exitCode = killed ? 124 : (code ?? 1)
        resolve({
          exitCode,
          success: exitCode === 0,
          durationMs,
          output: Buffer.concat(outputChunks).toString('utf-8'),
        })
      })
    })
  }
}

export function createAdapter(options: OpenCodeAdapterOptions): OpenCodeAdapter {
  return new OpenCodeAdapter(options)
}
