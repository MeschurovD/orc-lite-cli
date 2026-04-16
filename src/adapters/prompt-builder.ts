import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface PromptBuildParams {
  taskFile: string
  tasksDir: string
  systemPrompt?: string
  contextFiles?: string[]
  workingDir: string
}

export function buildPrompt(params: PromptBuildParams): string {
  const { taskFile, tasksDir, systemPrompt, contextFiles, workingDir } = params
  const parts: string[] = []

  if (systemPrompt) {
    parts.push(systemPrompt.trim())
    parts.push('')
  }

  const taskFilePath = resolve(workingDir, tasksDir, taskFile)
  if (!existsSync(taskFilePath)) {
    throw new Error(`Task file not found: ${taskFilePath}`)
  }
  const taskContent = readFileSync(taskFilePath, 'utf-8').trim()
  parts.push(taskContent)

  if (contextFiles && contextFiles.length > 0) {
    parts.push('')
    parts.push('Additional context files:')
    for (const ctxFile of contextFiles) {
      const ctxPath = resolve(workingDir, ctxFile)
      if (!existsSync(ctxPath)) {
        parts.push(`[context file not found: ${ctxFile}]`)
        continue
      }
      parts.push(`\n--- ${ctxFile} ---`)
      parts.push(readFileSync(ctxPath, 'utf-8').trim())
    }
  }

  return parts.join('\n')
}

// ─── Stage prompt builders ────────────────────────────────────────────────────

const DEFAULT_VERIFY_TEMPLATE = `Ты ревьюер AI-реализации. Оцени полноту и корректность.

## Исходная задача:
{taskContent}

## Вывод реализации:
{implementOutput}

## Изменения кода (git diff):
{gitDiff}

## Инструкции:
Оцени, полностью ли реализация покрывает требования задачи.
Выведи ТОЛЬКО валидный JSON (без markdown-обёрток):
{
  "approved": true/false,
  "score": 0-100,
  "reason": "если не одобрено — объясни почему (null если одобрено)",
  "short_summary": "краткая оценка в 1-2 предложениях для уведомлений",
  "full_summary": "детальный markdown-обзор с разделом для каждого требования",
  "issues": ["конкретная проблема 1", "конкретная проблема 2"]
}`

const DEFAULT_TEST_TEMPLATE = `Ты тестировщик. Напиши тесты для следующей реализации.

## Исходная задача:
{taskContent}

## Саммари реализации:
{implementOutput}

## Изменения кода (git diff):
{gitDiff}

## Инструкции:
1. Проанализируй изменения
2. Напиши unit-тесты, покрывающие ключевой функционал и краевые случаи
3. Запусти тесты и убедись, что они проходят`

function fillTemplate(
  template: string,
  vars: { taskContent: string; implementOutput: string; gitDiff: string },
): string {
  return template
    .replace(/\{taskContent\}/g, vars.taskContent)
    .replace(/\{implementOutput\}/g, vars.implementOutput)
    .replace(/\{gitDiff\}/g, vars.gitDiff)
}

function fillRetryTemplate(
  template: string,
  vars: {
    taskContent: string
    implementOutput: string
    gitDiff: string
    verifyIssues: string
    verifyReason: string
    verifyScore: string
    attempt: string
  },
): string {
  return template
    .replace(/\{taskContent\}/g, vars.taskContent)
    .replace(/\{implementOutput\}/g, vars.implementOutput)
    .replace(/\{gitDiff\}/g, vars.gitDiff)
    .replace(/\{verifyIssues\}/g, vars.verifyIssues)
    .replace(/\{verifyReason\}/g, vars.verifyReason)
    .replace(/\{verifyScore\}/g, vars.verifyScore)
    .replace(/\{attempt\}/g, vars.attempt)
}

export function buildVerifyPrompt(
  taskContent: string,
  implementOutput: string,
  gitDiff: string,
  customTemplate?: string,
): string {
  return fillTemplate(customTemplate ?? DEFAULT_VERIFY_TEMPLATE, { taskContent, implementOutput, gitDiff })
}

const DEFAULT_RETRY_IMPLEMENT_TEMPLATE = `Ты продолжаешь работу над задачей. Предыдущая реализация была проверена и найдены проблемы.

## Исходная задача:
{taskContent}

## Что было сделано (вывод предыдущей реализации):
{implementOutput}

## Текущее состояние кода (git diff):
{gitDiff}

## Результат верификации — проблемы (попытка {attempt}):
{verifyIssues}

## Причина отклонения:
{verifyReason}

## Инструкции:
Доработай реализацию. Сфокусируйся исключительно на невыполненных пунктах из списка выше.
Не переписывай то, что уже работает корректно.`

export interface RetryImplementPromptParams {
  taskContent: string
  implementOutput: string
  gitDiff: string
  verifyIssues: string[]
  verifyReason?: string
  verifyScore?: number
  attempt: number
  customTemplate?: string
}

export function buildRetryImplementPrompt(params: RetryImplementPromptParams): string {
  const {
    taskContent,
    implementOutput,
    gitDiff,
    verifyIssues,
    verifyReason,
    verifyScore,
    attempt,
    customTemplate,
  } = params

  const issuesText = verifyIssues.length > 0
    ? verifyIssues.map((i) => `- ${i}`).join('\n')
    : '(список проблем не предоставлен)'

  return fillRetryTemplate(customTemplate ?? DEFAULT_RETRY_IMPLEMENT_TEMPLATE, {
    taskContent,
    implementOutput: implementOutput || '(нет вывода)',
    gitDiff: gitDiff || '(нет изменений)',
    verifyIssues: issuesText,
    verifyReason: verifyReason || '(причина не указана)',
    verifyScore: String(verifyScore ?? 0),
    attempt: String(attempt),
  })
}

export function buildTestPrompt(
  taskContent: string,
  implementOutput: string,
  gitDiff: string,
  customTemplate?: string,
): string {
  return fillTemplate(customTemplate ?? DEFAULT_TEST_TEMPLATE, { taskContent, implementOutput, gitDiff })
}
