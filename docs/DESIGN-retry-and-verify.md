# Design: Retry-механизм и Verify-retry loop

> Дата: 2026-04-15

## Мотивация

Текущий retry в `task-runner.ts` перезапускает таск целиком с нуля (git checkout, пересоздание ветки, implement заново). Нет связи между verify stage и retry — issues из верификации теряются, следующая попытка не знает, что именно не было сделано.

Нужно:
1. Настраиваемый retry-механизм (задержки, backoff) через конфиг
2. Verify-retry loop — после неудачной верификации перезапускать implement с контекстом (issues, reason), не откатывая уже сделанные изменения

---

## 1. Настраиваемые ретраи (retry config)

### Текущее состояние

- `max_retries` — плоское число на уровне конфига и на уровне таска
- При ошибке на любом этапе — `continue` на следующую попытку, всё с нуля
- Нет задержек между попытками

### Решение

Добавить опциональный объект `retry` в `StageConfig` и `OrcLiteConfig`:

```json
{
  "retry": {
    "max_attempts": 3,
    "delay_seconds": 0,
    "backoff": "none",
    "backoff_base": 30
  }
}
```

| Поле | Тип | Default | Описание |
|------|-----|---------|----------|
| `max_attempts` | number | 0 | Макс. кол-во повторных попыток (0 = без ретраев) |
| `delay_seconds` | number | 0 | Пауза перед каждой повторной попыткой |
| `backoff` | `"none"` \| `"linear"` \| `"exponential"` | `"none"` | Стратегия увеличения задержки |
| `backoff_base` | number | 30 | Для linear: `+base` каждый раз; для exponential: `base * 2^attempt` |

Обратная совместимость: если указан только `max_retries: 2` (старый формат) — работает как сейчас, без задержек. `retry.max_attempts` приоритетнее `max_retries`.

Приоритет: таск `retry` > глобальный `retry` > `max_retries` (legacy fallback).

### Формула задержки

```
delay = delay_seconds                              (backoff: "none")
delay = delay_seconds + backoff_base * attempt      (backoff: "linear")
delay = delay_seconds + backoff_base * 2^attempt    (backoff: "exponential")
```

---

## 2. Verify-retry loop

### Текущее состояние

Stage pipeline в `task-runner.ts`:
```
for (stage of stages):
  run stage
  if fail → break → continue outer retry (всё с нуля)
```

Verify stage (`stages/verify.ts`):
- Запускает opencode с промтом ревью
- Парсит JSON: `{ approved, score, issues, reason, short_summary, full_summary }`
- `on_fail: "stop"` → stage failed → outer retry или fail
- `on_fail: "continue"` → проглатывает ошибку
- Issues никуда не передаются

### Решение

Добавить `on_fail: "retry"` для verify stage. При этом значении вместо полного рестарта таска запускается **внутренний цикл implement→verify**.

#### Новый поток выполнения

```
outer retry loop (general errors: git fail, hook fail, unexpected):
  git setup
  pre_hook

  inner verify-retry loop (max_verify_retries итераций):
    run implement
      - attempt=0: обычный промт
      - attempt>0: retry-промт с issues из предыдущей верификации
    
    if "verify" in stages:
      run verify
      if verify.approved == false AND inner_retries < max_verify_retries:
        собираем issues → continue inner loop
      elif verify.approved == false:
        fail → break → continue outer loop (или stop)
    
    if "test" in stages:
      run test
    
    break inner loop (всё ок)

  post_hook
  verification_cmd
  merge / push / done
```

#### Ключевое отличие inner loop от outer loop

| | Outer retry | Inner verify-retry |
|---|---|---|
| Когда | Ошибки git, hook, unexpected exception | verify.approved == false |
| Git | Пересоздаёт ветку с нуля | НЕ трогает git — агент работает поверх своих изменений |
| Контекст | Чистый старт | Передаёт issues и reason из верификации |
| Промт | Оригинальный | Специальный retry-промт |

### Конфиг verify stage

```json
{
  "stages": {
    "verify": {
      "threshold": 80,
      "on_fail": "retry",
      "max_retries": 3,
      "retry_prompt_template": "...",
      "timeout": 300
    }
  }
}
```

| Поле | Тип | Default | Описание |
|------|-----|---------|----------|
| `on_fail` | `"stop"` \| `"continue"` \| `"retry"` | `"stop"` | Что делать при неудачной верификации |
| `max_retries` | number | 2 | Сколько раз перезапускать implement после failed verify (только при `on_fail: "retry"`) |
| `retry_prompt_template` | string | (встроенный) | Кастомный промт для retry implement |

---

## 3. Retry-промт для implement

При `on_fail: "retry"` и повторном запуске implement используется специальный промт.

### Дефолтный шаблон

```
Ты продолжаешь работу над задачей. Предыдущая реализация была проверена и найдены проблемы.

## Исходная задача:
{taskContent}

## Что было сделано (вывод предыдущей реализации):
{implementOutput}

## Результат верификации — проблемы:
{verifyIssues}

## Причина отклонения:
{verifyReason}

## Инструкции:
Доработай реализацию. Сфокусируйся на невыполненных пунктах.
Не переписывай то, что уже работает корректно.
```

### Переменные шаблона

| Переменная | Описание |
|---|---|
| `{taskContent}` | Содержимое файла задачи |
| `{implementOutput}` | Вывод предыдущего запуска implement |
| `{gitDiff}` | Текущий git diff |
| `{verifyIssues}` | Список issues из verify (каждый с новой строки через `- `) |
| `{verifyReason}` | Поле reason из verify JSON |
| `{verifyScore}` | Числовой score из verify |
| `{attempt}` | Номер текущей попытки (1, 2, 3...) |

---

## 4. Изменения в типах (`types.ts`)

### StageConfig

```diff
 interface StageConfig {
   prompt_template?: string
   model?: string
   timeout?: number
   threshold?: number
-  on_fail?: 'stop' | 'continue'
+  on_fail?: 'stop' | 'continue' | 'retry'
+  max_retries?: number
+  retry_prompt_template?: string
 }
```

### StageContext (`stages/index.ts`)

```diff
 interface StageContext {
   task: TaskDefinition
   taskIndex: number
   config: OrcLiteConfig
   stageConfig?: StageConfig
   workingDir: string
   log: TaskLogger
   implementOutput: string
   gitDiff: string
   taskContent: string
+  verifyIssues?: string[]
+  verifyReason?: string
+  verifyScore?: number
+  isRetry?: boolean
 }
```

### RetryConfig (новый тип)

```typescript
interface RetryConfig {
  max_attempts?: number
  delay_seconds?: number
  backoff?: 'none' | 'linear' | 'exponential'
  backoff_base?: number
}
```

### OrcLiteConfig

```diff
 interface OrcLiteConfig {
   ...
   max_retries: number          // legacy, сохраняем для обратной совместимости
+  retry?: RetryConfig
   ...
 }
```

### TaskDefinition

```diff
 interface TaskDefinition {
   ...
   max_retries?: number         // legacy
+  retry?: RetryConfig
   ...
 }
```

---

## 5. Изменения по файлам

| Файл | Что меняется |
|------|-------------|
| `types.ts` | Новый `RetryConfig`, расширение `StageConfig`, `StageContext`, `OrcLiteConfig`, `TaskDefinition` |
| `core/config.ts` | Zod-схема: `on_fail` → `z.enum(['stop', 'continue', 'retry'])`, новая `retryConfigSchema`, добавить `retry` в `baseSchema` и `taskSchema` |
| `adapters/prompt-builder.ts` | Новая функция `buildRetryImplementPrompt(...)` |
| `core/task-runner.ts` | Заменить простой `for (stage of stages)` на логику с inner verify-retry loop; добавить расчёт задержки между outer retries |
| `core/stages/implement.ts` | Поддержка `isRetry` + `verifyIssues` — выбор между обычным и retry промтом |
| `core/stages/index.ts` | Расширение `StageContext` |
| `core/stages/verify.ts` | Без изменений (уже возвращает issues и reason в StageResult) |

---

## 6. Поток данных (пример)

```
implement(attempt=0)
  → prompt: обычный (taskContent + context_files)
  → output: "реализовал API endpoint, добавил middleware"
  → git diff: +150 lines

verify(attempt=0)
  → approved: false, score: 55
  → issues: ["нет обработки ошибок в middleware", "не добавлена миграция БД"]
  → reason: "реализация неполная — отсутствуют 2 из 4 требований"

implement(attempt=1, isRetry=true)
  → prompt: retry-промт с issues из verify
  → output: "добавил обработку ошибок, создал миграцию"
  → git diff: +200 lines (накопленный)

verify(attempt=1)
  → approved: true, score: 92
  → issues: []
  → done → продолжаем к test stage
```

---

## 7. Порядок реализации

1. Расширить типы в `types.ts` — `RetryConfig`, `StageConfig.on_fail`, `StageContext` поля
2. Обновить zod-схему в `config.ts` — `retryConfigSchema`, `on_fail: retry`, добавить в `baseSchema` и `taskSchema`
3. Добавить `buildRetryImplementPrompt` в `prompt-builder.ts`
4. Обновить `stages/index.ts` — расширить `StageContext`
5. Обновить `stages/implement.ts` — поддержка `isRetry`, выбор промта
6. Реализовать inner verify-retry loop в `task-runner.ts`
7. Добавить delay/backoff логику в outer retry loop в `task-runner.ts`
8. Обновить dry-run в `orchestrator.ts` — показывать retry и verify-retry настройки
9. Тесты для retry delay calculation и verify-retry flow

---

## 8. Открытые вопросы

1. **Git при inner retry**: агент работает поверх своих изменений, но коммитить ли промежуточные результаты между inner retries? 
   > Решение: да, коммитить после каждого implement (как сейчас), чтобы verify видел чистый diff именно текущей итерации.

2. **Лимит на суммарные токены**: при 3 inner retries + 2 outer retries может набежать много токенов. Нужен ли `max_total_tokens` лимит?
   > Решение: пока нет — пользователь контролирует через max_retries. Можно добавить позже.

3. **Комбинация outer + inner retries**: если inner verify-retry loop исчерпал попытки и verify всё ещё fail — это считается ошибкой для outer retry? 
   > Решение: да, outer retry начнёт всё с нуля (новая ветка, чистый implement). Суммарно максимум `(outer_retries + 1) * (inner_retries + 1)` вызовов implement.
