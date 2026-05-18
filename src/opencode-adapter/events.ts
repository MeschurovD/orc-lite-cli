import type { OpenCodeDisplayState, OpenCodeUsage } from './types.js'

function writeText(text: string, teeStream: NodeJS.WritableStream, state: OpenCodeDisplayState): void {
  if (!text) return

  if (!state.atLineStart) {
    teeStream.write('\n')
    state.atLineStart = true
  }

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line) teeStream.write('  ' + line)
    if (i < lines.length - 1) {
      teeStream.write('\n')
    }
  }

  teeStream.write('\n')
  state.atLineStart = true
}

export function processOpenCodeJsonLine(
  line: string,
  teeStream: NodeJS.WritableStream,
  usage: OpenCodeUsage,
  outputParts: string[],
  state: OpenCodeDisplayState,
): void {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(line) as Record<string, unknown>
  } catch {
    teeStream.write(line + '\n')
    state.atLineStart = true
    return
  }

  const type = event['type'] as string | undefined
  const part = event['part'] as Record<string, unknown> | undefined

  switch (type) {
    case 'text': {
      const text = (part?.['text'] ?? event['text']) as string | undefined
      if (text) {
        writeText(text, teeStream, state)
        outputParts.push(text)
      }
      break
    }

    case 'tool_use': {
      const name = (part?.['tool'] ?? part?.['name'] ?? event['toolName']) as string | undefined
      if (name) {
        teeStream.write(`\n  [tool: ${name}]\n`)
        state.atLineStart = true
      }
      break
    }

    case 'step_start':
    case 'step_finish':
      break

    case 'text-delta': {
      const text = (event['text'] ?? event['textDelta']) as string | undefined
      if (text) {
        writeText(text, teeStream, state)
        outputParts.push(text)
      }
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
