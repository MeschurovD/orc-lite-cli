import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function buildPrompt(params) {
    const { taskFile, tasksDir, systemPrompt, contextFiles, workingDir } = params;
    const parts = [];
    if (systemPrompt) {
        parts.push(systemPrompt.trim());
        parts.push('');
    }
    const taskFilePath = resolve(workingDir, tasksDir, taskFile);
    if (!existsSync(taskFilePath)) {
        throw new Error(`Task file not found: ${taskFilePath}`);
    }
    const taskContent = readFileSync(taskFilePath, 'utf-8').trim();
    parts.push(taskContent);
    if (contextFiles && contextFiles.length > 0) {
        parts.push('');
        parts.push('Additional context files:');
        for (const ctxFile of contextFiles) {
            const ctxPath = resolve(workingDir, ctxFile);
            if (!existsSync(ctxPath)) {
                parts.push(`[context file not found: ${ctxFile}]`);
                continue;
            }
            parts.push(`\n--- ${ctxFile} ---`);
            parts.push(readFileSync(ctxPath, 'utf-8').trim());
        }
    }
    return parts.join('\n');
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
}`;
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
3. Запусти тесты и убедись, что они проходят`;
function fillTemplate(template, vars) {
    return template
        .replace(/\{taskContent\}/g, vars.taskContent)
        .replace(/\{implementOutput\}/g, vars.implementOutput)
        .replace(/\{gitDiff\}/g, vars.gitDiff);
}
export function buildVerifyPrompt(taskContent, implementOutput, gitDiff, customTemplate) {
    return fillTemplate(customTemplate ?? DEFAULT_VERIFY_TEMPLATE, { taskContent, implementOutput, gitDiff });
}
export function buildTestPrompt(taskContent, implementOutput, gitDiff, customTemplate) {
    return fillTemplate(customTemplate ?? DEFAULT_TEST_TEMPLATE, { taskContent, implementOutput, gitDiff });
}
//# sourceMappingURL=prompt-builder.js.map