# orc-lite-cli - Архитектура

## Обзор

**orc-lite-cli** - облегчённая версия orc-cli, заточенная под рабочие задачи.
Единственный адаптер - **opencode** (подключена рабочая LLM, без утечек данных).
Ключевое отличие от orc-cli - встроенный **планировщик** для отложенного запуска очередей задач (ночные прогоны, запуск в заданное время).

## Что берём из orc-cli

| Модуль | Источник | Изменения |
|--------|----------|-----------|
| Оркестратор | `core/orchestrator.ts` | Упрощение: убрать UI-события, работа с очередями вместо плоского tasks |
| Task Runner | `core/task-runner.ts` | Без изменений по логике |
| Stages | `core/stages/*` | Перенести implement, verify, test |
| OpenCode адаптер | `adapters/opencode-adapter.ts` | Единственный адаптер |
| Prompt Builder | `adapters/prompt-builder.ts` | Убрать упоминания других адаптеров |
| Git-сервис | `services/git.ts` | Без изменений |
| Логгер | `services/logger.ts` | Убрать EventBus интеграцию |
| Нотификации | `services/notifier.ts` | Telegram + webhook, прокси |
| Конфиг | `core/config.ts` | Новая схема с queues + обратная совместимость с tasks |
| Типы | `types.ts` | Убрать UI-типы, добавить типы очередей и расписания |

## Что НЕ берём

- Claude / Codex адаптеры
- UI сервер, React фронтенд, dist-ui
- EventBus, Pipeline Manager
- UI Registry, Global Config
- Команды: register, unregister, ui
- CodexOutputParser

---

## Модель данных: Очереди (queues)

### Концепция

Вместо плоского массива `tasks` (как в orc-cli) используется массив **очередей** (`queues`).
Каждая очередь — группа задач, которая может иметь своё расписание.

CLI работает в трёх режимах:

1. **Немедленный** (`orc-lite run`) — запускает первую незавершённую очередь
2. **По номеру** (`orc-lite run 2`) — запускает конкретную очередь
3. **Демон** (`orc-lite daemon`) — фоновый процесс, мониторит планировщик и запускает очереди по расписанию

### Обратная совместимость

Если в конфиге найден плоский `tasks` вместо `queues`, при загрузке автоматически оборачиваем в одну дефолтную очередь:

```ts
if (raw.tasks && !raw.queues) {
  raw.queues = [{ name: "default", schedule: null, tasks: raw.tasks }]
}
```

Это позволяет использовать простой формат для проектов без нескольких очередей и расписаний.

---

## Конфиг: orc-lite.config.json

### Новый формат (с очередями)

```jsonc
{
  // --- общие параметры (из orc-cli) ---
  "target_branch": "main",
  "tasks_dir": "tasks",
  "logs_dir": ".orc-lite/logs",
  "adapter_options": {
    "timeout": 300,               // таймаут на задачу в секундах (опционально)
    "insecure_tls": false         // запустить opencode с NODE_TLS_REJECT_UNAUTHORIZED=0 (опционально)
  },
  "push": "end",                   // each | end | none
  "max_retries": 1,
  "hooks": {
    "pre_task": null,
    "post_task": null
  },
  "notifications": {
    "telegram": {
      "bot_token": "",
      "chat_id": "",
      "proxy": null,
      "use_env_proxy": false
    }
  },
  "auto_pr": false,
  "stages": {
    "verify": { "enabled": false, "threshold": 80 },
    "test": { "enabled": false }
  },

  // --- настройки демона ---
  "daemon": {
    "poll_interval": 60,            // секунды, как часто перечитывать scheduler.json
    "log_file": ".orc-lite/daemon.log"
  },

  // --- очереди ---
  "queues": [
    {
      "name": "auth-refactor",
      "schedule": null,             // null = ручной запуск
      "status": "pending",          // pending | in_progress | done | failed
      "tasks": [
        {
          "file": "tasks/auth-cleanup.md",
          "status": "pending",
          "context_files": [],
          "verification_cmd": null,
          "max_retries": null,
          "stages": ["implement"]
        },
        {
          "file": "tasks/auth-tests.md",
          "status": "pending"
        }
      ]
    },
    {
      "name": "nightly-fixes",
      "schedule": "2:30",           // ближайшие 2:30
      "status": "pending",
      "tasks": [
        { "file": "tasks/fix-api.md", "status": "pending" },
        { "file": "tasks/fix-types.md", "status": "pending" }
      ]
    },
    {
      "name": "friday-deploy",
      "schedule": "2026-04-11 18:00",
      "status": "pending",
      "tasks": [
        { "file": "tasks/deploy-prep.md", "status": "pending" }
      ]
    }
  ]
}
```

### Совместимый формат (плоский tasks)

```jsonc
{
  "target_branch": "main",
  "tasks_dir": "tasks",
  // ...
  "tasks": [
    { "file": "tasks/example.md", "status": "pending" }
  ]
}
```

При загрузке автоматически конвертируется в `queues: [{ name: "default", tasks: [...] }]`.

---

## Планировщик

### Центральный реестр: ~/.orc-lite/scheduler.json

Планировщик хранит зарегистрированные jobs в глобальном файле, общем для всех репозиториев:

```jsonc
{
  "jobs": [
    {
      "id": "a1b2c3",                              // уникальный ID
      "repo": "/opt/work/project-a",               // абсолютный путь к репо
      "config": "orc-lite.config.json",             // путь к конфигу (если нестандартный)
      "queue_index": 1,                             // индекс очереди (0-based)
      "queue_name": "nightly-fixes",                // для читаемости
      "scheduled_at": "2026-04-09T02:30:00",        // нормализованное ISO время
      "registered_at": "2026-04-08T19:15:00",       // когда зарегистрировано
      "status": "scheduled"                         // scheduled | running | done | failed | cancelled
    }
  ]
}
```

### Парсинг времени

Функция `parseScheduleTime(input: string): Date` поддерживает форматы:

| Ввод | Интерпретация |
|------|---------------|
| `"2:30"` | Ближайшие 2:30 (если сейчас 19:00 — сегодня ночью; если 1:00 — через 1.5 часа) |
| `"14:30"` | Ближайшие 14:30 |
| `"2026-04-09"` | 2026-04-09 00:00:00 |
| `"2026-04-09 2:30"` | 2026-04-09 02:30:00 |
| `"2026-04-09T02:30:00"` | ISO 8601 — как есть |

Реализация — чистая функция без тяжёлых зависимостей. Повторяющиеся задачи (cron) не поддерживаются в текущей версии.

### Автоматическая регистрация

Команда `orc-lite schedule` при установке времени автоматически:
1. Записывает `schedule` в конфиг проекта (`orc-lite.config.json`)
2. Регистрирует job в `~/.orc-lite/scheduler.json` (если ещё не зарегистрирован)

### Автоматическая очистка

Когда очередь завершена (status = done) — соответствующий job удаляется из scheduler.json автоматически.

---

## CLI команды

### Запуск очередей

```bash
orc-lite run              # первая незавершённая очередь (status != done)
orc-lite run 2            # очередь #2 (1-based нумерация)
orc-lite run --all        # все pending очереди последовательно
```

### Регистрация в планировщике

```bash
orc-lite register         # читает конфиг текущего репо, находит очереди с schedule,
                          # регистрирует их в ~/.orc-lite/scheduler.json
```

### Управление расписанием

```bash
# Назначить время (пишет в конфиг + регистрирует в планировщике)
orc-lite schedule 2:30                  # для первой pending очереди
orc-lite schedule 2 2:30               # для очереди #2
orc-lite schedule 2 "2026-04-11 5:00"  # с конкретной датой

# Просмотр и управление
orc-lite schedule --list               # все запланированные jobs (все репо)
orc-lite schedule --cancel             # отменить все jobs текущего репо
orc-lite schedule --cancel <id>        # отменить конкретный job по ID
```

### Демон

```bash
orc-lite daemon           # запустить фоновый процесс
```

### Прочие команды (из orc-cli)

```bash
orc-lite init             # инициализация конфига (генерирует формат с queues)
orc-lite status           # статус очередей и задач
orc-lite add <file>       # добавить задачу в очередь
orc-lite reset <file>     # сбросить задачу
orc-lite logs             # просмотр логов
orc-lite validate         # валидация конфига
```

---

## Потоки выполнения

### orc-lite run [N]

```
orc-lite run [N]
  ├─ Загрузить конфиг (queues или tasks → queues)
  ├─ Проверки: git repo, target branch, opencode установлен
  ├─ Выбор очереди:
  │   ├─ N указан → queue = queues[N-1]
  │   └─ N не указан → queue = первая очередь где status != done
  ├─ Для каждой pending задачи в queue:
  │   ├─ runTask() → stages → commit → merge
  │   └─ Нотификация в Telegram
  ├─ Обновить queue.status в конфиге
  ├─ Push (если настроен)
  └─ Финальная нотификация
```

### orc-lite register

```
orc-lite register
  ├─ Загрузить orc-lite.config.json
  ├─ Для каждой очереди с schedule != null и status != done:
  │   ├─ parseScheduleTime(schedule) → абсолютная дата
  │   ├─ Если дата в прошлом → предупредить, пропустить
  │   └─ Добавить/обновить job в ~/.orc-lite/scheduler.json
  ├─ Удалить jobs для очередей, у которых schedule убрали
  └─ Вывести список зарегистрированных jobs
```

### orc-lite schedule <time>

```
orc-lite schedule [queue_num] <time>
  ├─ Загрузить конфиг
  ├─ Определить очередь (по номеру или первая pending)
  ├─ parseScheduleTime(time) → абсолютная дата
  ├─ Записать schedule в конфиг (queues[i].schedule = time)
  ├─ Сохранить конфиг на диск
  ├─ Если job ещё не зарегистрирован:
  │   └─ Добавить в ~/.orc-lite/scheduler.json
  └─ Вывести подтверждение
```

### orc-lite daemon

```
orc-lite daemon
  ├─ Загрузить ~/.orc-lite/scheduler.json
  ├─ Для каждого scheduled job:
  │   └─ setTimeout(runJob, delta до scheduled_at)
  ├─ runJob(job):
  │   ├─ Обновить job.status = "running"
  │   ├─ cd job.repo
  │   ├─ Загрузить orc-lite.config.json
  │   ├─ Запустить очередь queues[job.queue_index]
  │   ├─ Если успех → удалить job из scheduler.json
  │   ├─ Если ошибка → job.status = "failed"
  │   └─ Нотификация (Telegram)
  ├─ Периодически перечитывать scheduler.json (poll_interval)
  │   └─ Подхват новых jobs, отмена cancelled
  └─ Graceful shutdown по SIGINT/SIGTERM
```

---

## Структура проекта

```
orc-lite-cli/
├── src/
│   ├── index.ts                  # CLI entry point (Commander.js)
│   ├── types.ts                  # Типы (очереди, задачи, расписание)
│   ├── core/
│   │   ├── orchestrator.ts       # Пайплайн оркестратор (работа с очередями)
│   │   ├── config.ts             # Конфиг + Zod (queues + совместимость с tasks)
│   │   ├── task-runner.ts        # Запуск отдельной задачи
│   │   ├── scheduler.ts          # Планировщик: реестр, парсинг времени, таймеры
│   │   └── stages/
│   │       ├── index.ts          # Роутер стадий
│   │       ├── implement.ts      # Имплементация
│   │       ├── verify.ts         # Верификация
│   │       └── test.ts           # Тесты
│   ├── adapters/
│   │   ├── opencode-adapter.ts   # Единственный адаптер
│   │   └── prompt-builder.ts     # Сборка промптов
│   ├── services/
│   │   ├── git.ts                # Git операции
│   │   ├── logger.ts             # Логирование
│   │   └── notifier.ts           # Telegram + webhook
│   └── commands/
│       ├── run.ts                # Запуск очереди (по номеру или первая pending)
│       ├── daemon.ts             # Фоновый демон
│       ├── register.ts           # Регистрация очередей в планировщике
│       ├── schedule.ts           # Назначение времени + управление расписанием
│       ├── add.ts                # Добавить задачу в очередь
│       ├── init.ts               # Инициализация конфига
│       ├── status.ts             # Статус очередей и задач
│       ├── reset.ts              # Сброс задачи
│       ├── logs.ts               # Просмотр логов
│       └── validate.ts           # Валидация конфига
├── package.json
├── tsconfig.json
└── docs/
    └── ARCHITECTURE.md           # Этот файл
```

## Стек технологий

| Зависимость | Назначение |
|-------------|------------|
| typescript | Язык |
| commander | CLI |
| zod | Валидация конфига |
| simple-git | Git операции |
| undici | HTTP (Telegram, webhook, прокси) |
| chalk | Цвета в терминале |

> **croner** убран из зависимостей — повторяющиеся задачи (cron) не поддерживаются в текущей версии. Парсинг времени реализован встроенной функцией `parseScheduleTime()`.

## Типы

### Ключевые интерфейсы

```ts
// Статус задачи
type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'conflict' | 'skipped'

// Статус очереди
type QueueStatus = 'pending' | 'in_progress' | 'done' | 'failed'

// Задача (как в orc-cli)
interface TaskDefinition {
  file: string
  status: TaskStatus
  branch?: string
  context_files?: string[]
  verification_cmd?: string
  max_retries?: number
  hooks?: TaskHooks
  stages?: StageName[]
  started_at?: string
  completed_at?: string
  error?: string
  retry_count?: number
  tokens_used?: number
  cost_usd?: number
}

// Очередь
interface QueueDefinition {
  name?: string                    // опционально, для читаемости
  schedule?: string | null         // время запуска (парсится parseScheduleTime)
  status: QueueStatus
  tasks: TaskDefinition[]
}

// Job в планировщике
interface SchedulerJob {
  id: string                       // nanoid или crypto.randomUUID
  repo: string                     // абсолютный путь
  config?: string                  // путь к конфигу (если нестандартный)
  queue_index: number              // 0-based индекс очереди
  queue_name?: string              // для читаемости
  scheduled_at: string             // ISO 8601
  registered_at: string            // ISO 8601
  status: 'scheduled' | 'running' | 'done' | 'failed' | 'cancelled'
}

// Конфиг
interface OrcLiteConfig {
  target_branch: string
  tasks_dir: string
  logs_dir: string
  // ... общие поля ...
  daemon?: DaemonConfig
  queues: QueueDefinition[]        // внутри всегда queues
}
```
