import type { Writable } from 'node:stream'

export interface OpenCodeAdapterOptions {
  timeout?: number
  insecure_tls?: boolean
}

export interface AdapterExecuteParams {
  prompt: string
  workingDir: string
  timeout: number
  teeStream: Writable
  fullLogStream?: Writable
}

export interface AdapterResult {
  exitCode: number
  success: boolean
  durationMs: number
  tokensUsed?: number
  costUsd?: number
  output?: string
}

export interface OpenCodeUsage {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface OpenCodeDisplayState {
  atLineStart: boolean
}
