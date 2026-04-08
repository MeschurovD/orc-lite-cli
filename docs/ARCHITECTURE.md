# orc-lite-cli - Архитектура

## Обзор

**orc-lite-cli** - облегчённая версия orc-cli, заточенная под рабочие задачи.
Единственный адаптер - **opencode** (подключена рабочая LLM, без утечек данных).
Ключевое отличие от orc-cli - встроенный **планировщик** для отложенного запуска задач (ночные прогоны, запуск в заданное время).

## Что берём из orc-cli

| Модуль | Источник | Изменения |
|--------|----------|-----------|
| Оркестратор | `core/orchestrator.ts` | Упрощение: убрать UI-события, dry-run оставить |
| Task Runner | `core/task-runner.ts` | Без изменений по логике |
| Stages | `core/stages/*` | Перенести implement, verify, test |
| OpenCode адаптер | `adapters/opencode-adapter.ts` | Единственный адаптер |
| Prompt Builder | `adapters/prompt-builder.ts` | Убрать упоминания других адаптеров |
| Git-сервис | `services/git.ts` | Без изменений |
| Логгер | `services/logger.ts` | Убрать EventBus интеграцию |
| Нотификации | `services/notifier.ts` | Telegram + webhook, прокси |
| Конфиг | `core/config.ts` | Расширить схему полем schedule |
| Типы | `types.ts` | Убрать UI-типы, добавить типы расписания |

## Что НЕ берём

- Claude / Codex адаптеры
- UI сервер, React фронтенд, dist-ui
- EventBus, Pipeline Manager
- UI Registry, Global Config
- Команды: register, unregister, ui
- CodexOutputParser

## Новый функционал: Планировщик

### Концепция

Задачи в очереди могут иметь опциональное поле `schedule` - время, когда задачу нужно запустить. CLI работает в двух режимах:

1. **Немедленный** (`orc-lite run`) - как orc-cli, выполняет все pending задачи сейчас
2. **Демон** (`orc-lite daemon`) - фоновый процесс, который мониторит очередь и запускает задачи по расписанию

### Формат расписания в конфиге

```jsonc
{
  "tasks": [
    {
      "file": "tasks/refactor-auth.md",
      "status": "pending"
      // нет schedule = выполнится при ближайшем `orc-lite run`
    },
    {
      "file": "tasks/migrate-db.md",
      "status": "pending",
      "schedule": "2026-04-09T02:00:00"
      // ISO 8601 - конкретная дата и время
    },
    {
      "file": "tasks/nightly-lint.md",
      "status": "pending",
      "schedule": "0 2 * * *"
      // cron-выражение - повторяющееся расписание
    }
  ]
}
```

### Типы расписания

| Тип | Формат | Пример | Поведение |
|-----|--------|--------|-----------|
| Разовый | ISO 8601 datetime | `"2026-04-09T02:00:00"` | Запуск один раз в указанное время |
| Повторяющийся | cron expression | `"0 2 * * *"` | Запуск по расписанию (каждую ночь в 2:00) |
| Немедленный | отсутствует | - | Выполняется при `orc-lite run` |

### Демон (daemon)

```
orc-lite daemon [--config path]
```

- Долгоживущий процесс (запускать в tmux/screen/systemd)
- Читает конфиг, находит задачи с `schedule`
- Для cron-выражений использует `node-cron` или `croner`
- Для ISO-дат использует `setTimeout` с вычислением дельты
- При наступлении времени запускает pipeline для конкретной задачи
- Логирует в файл + отправляет Telegram нотификации
- Перечитывает конфиг периодически (или по SIGHUP) для подхвата новых задач
- Graceful shutdown по SIGINT/SIGTERM

### CLI команды для управления расписанием

```bash
# Добавить задачу с расписанием
orc-lite add <task-file> --schedule "2026-04-09T02:00:00"
orc-lite add <task-file> --cron "0 2 * * *"

# Посмотреть очередь с расписаниями
orc-lite queue

# Изменить расписание задачи
orc-lite schedule <task-file> "0 3 * * 1-5"

# Убрать расписание (сделать немедленной)
orc-lite schedule <task-file> --clear
```

## Структура проекта

```
orc-lite-cli/
├── src/
│   ├── index.ts                  # CLI entry point (Commander.js)
│   ├── types.ts                  # Типы
│   ├── core/
│   │   ├── orchestrator.ts       # Пайплайн оркестратор
│   │   ├── config.ts             # Конфиг + Zod схема
│   │   ├── task-runner.ts        # Запуск отдельной задачи
│   │   ├── scheduler.ts          # *** НОВОЕ: планировщик ***
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
│       ├── run.ts                # Немедленный запуск
│       ├── daemon.ts             # *** НОВОЕ: фоновый демон ***
│       ├── add.ts                # *** НОВОЕ: добавить задачу ***
│       ├── queue.ts              # *** НОВОЕ: очередь ***
│       ├── schedule.ts           # *** НОВОЕ: управление расписанием ***
│       ├── init.ts               # Инициализация конфига
│       ├── status.ts             # Статус пайплайна
│       ├── reset.ts              # Сброс задачи
│       ├── logs.ts               # Просмотр логов
│       └── validate.ts           # Валидация конфига
├── package.json
├── tsconfig.json
└── docs/
    ├── ARCHITECTURE.md           # Этот файл
    └── TASKS.md                  # Задачи на реализацию
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
| croner | Cron-парсер и планировщик |

> **croner** выбран вместо node-cron: нет внешних зависимостей, поддерживает ISO даты, ESM-совместим.

## Конфиг: orc-lite.config.json

```jsonc
{
  // --- из orc-cli ---
  "target_branch": "main",
  "tasks_dir": "tasks",
  "logs_dir": ".orc-lite/logs",
  "adapter_options": {
    // опции для opencode, если нужны
  },
  "push": "end",              // each | end | none
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

  // --- новое ---
  "daemon": {
    "poll_interval": 60,       // секунды, как часто перечитывать конфиг
    "log_file": ".orc-lite/daemon.log"
  },

  "tasks": [
    {
      "file": "tasks/example.md",
      "status": "pending",
      "schedule": null,          // null | ISO datetime | cron expression
      "context_files": [],
      "verification_cmd": null,
      "max_retries": null,
      "stages": ["implement"]
    }
  ]
}
```

## Поток выполнения

### Режим run (немедленный)

```
orc-lite run
  ├─ Загрузить конфиг
  ├─ Проверки: git repo, target branch, opencode установлен
  ├─ Отфильтровать задачи: status=pending И schedule=null
  ├─ Для каждой задачи:
  │   ├─ runTask() → stages → commit → merge
  │   └─ Нотификация в Telegram
  ├─ Push (если настроен)
  └─ Финальная нотификация
```

### Режим daemon (по расписанию)

```
orc-lite daemon
  ├─ Загрузить конфиг
  ├─ Инициализация планировщика (croner)
  ├─ Для каждой задачи с schedule:
  │   ├─ ISO дата → одноразовый таймер
  │   └─ cron → повторяющийся job
  ├─ Цикл:
  │   ├─ Ждать наступления события
  │   ├─ Выполнить задачу (runTask)
  │   ├─ Обновить статус в конфиге
  │   ├─ Нотификация в Telegram
  │   └─ Перечитать конфиг (poll_interval)
  └─ Graceful shutdown по сигналу
```
