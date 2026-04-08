import { createWriteStream, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { PassThrough, type Writable } from 'node:stream'
import chalk from 'chalk'

// ─── Capture stream ───────────────────────────────────────────────────────────

export function createCaptureStream(): { stream: PassThrough; getOutput: () => string } {
  const chunks: Buffer[] = []
  const stream = new PassThrough()
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
  return {
    stream,
    getOutput: () => Buffer.concat(chunks).toString('utf-8'),
  }
}

const BOX_WIDTH = 60

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8)
}

function boxTop(): string {
  return chalk.dim('┌─ opencode ' + '─'.repeat(BOX_WIDTH - 12) + '┐')
}

function boxBottom(): string {
  return chalk.dim('└' + '─'.repeat(BOX_WIDTH - 1) + '┘')
}

// ─── Pipeline logger (no file) ───────────────────────────────────────────────

export const pipelineLogger = {
  info(msg: string) {
    console.log(`${chalk.dim(`[${timestamp()}]`)} ${msg}`)
  },
  success(msg: string) {
    console.log(`${chalk.dim(`[${timestamp()}]`)} ${chalk.green('✓')} ${msg}`)
  },
  error(msg: string) {
    console.error(`${chalk.dim(`[${timestamp()}]`)} ${chalk.red('✗')} ${msg}`)
  },
  separator() {
    console.log(chalk.dim('─'.repeat(BOX_WIDTH)))
  },
}

// ─── Task logger (console + file) ────────────────────────────────────────────

export interface TaskLogger {
  step(msg: string): void
  success(msg: string): void
  error(msg: string): void
  raw(msg: string): void
  openCodexFrame(): void
  closeCodexFrame(): void
  fileStream: Writable
  teeStream: Writable
  close(): void
}

export function createTaskLogger(taskName: string, logsDir: string): TaskLogger {
  mkdirSync(logsDir, { recursive: true })
  const logPath = join(logsDir, `${taskName}.log`)
  const fileStream = createWriteStream(logPath, { flags: 'a' })

  function writeFile(msg: string) {
    fileStream.write(msg + '\n')
  }

  function writeConsole(msg: string) {
    process.stdout.write(msg + '\n')
  }

  const tee = new PassThrough()
  tee.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk)
  })

  writeFile(`\n${'='.repeat(BOX_WIDTH)}`)
  writeFile(`Task: ${taskName}`)
  writeFile(`Started: ${new Date().toISOString()}`)
  writeFile('='.repeat(BOX_WIDTH))

  return {
    step(msg: string) {
      const line = `  ${chalk.cyan('→')} ${msg}`
      writeConsole(line)
      writeFile(`  → ${msg}`)
    },
    success(msg: string) {
      const line = `  ${chalk.green('✓')} ${msg}`
      writeConsole(line)
      writeFile(`  ✓ ${msg}`)
    },
    error(msg: string) {
      const line = `  ${chalk.red('✗')} ${msg}`
      writeConsole(line)
      writeFile(`  ✗ ${msg}`)
    },
    raw(msg: string) {
      writeConsole(msg)
      writeFile(msg)
    },
    openCodexFrame() {
      writeConsole(boxTop())
      writeFile(`--- opencode output ---`)
    },
    closeCodexFrame() {
      writeConsole(boxBottom())
      writeFile(`--- end opencode output ---`)
    },
    fileStream,
    teeStream: tee,
    close() {
      tee.end()
      fileStream.end()
    },
  }
}

// ─── File logger (for daemon) ─────────────────────────────────────────────────

export function createFileLogger(logFile: string): {
  info(msg: string): void
  error(msg: string): void
  close(): void
} {
  mkdirSync(dirname(logFile), { recursive: true })
  const stream = createWriteStream(logFile, { flags: 'a' })

  function write(level: string, msg: string) {
    const ts = new Date().toISOString()
    stream.write(`[${ts}] [${level}] ${msg}\n`)
  }

  return {
    info(msg: string) { write('INFO', msg) },
    error(msg: string) { write('ERROR', msg) },
    close() { stream.end() },
  }
}
