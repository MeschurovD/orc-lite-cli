# Manual Test Plan — Interactive CLI & Per-Queue Defaults

Охватывает три фичи из коммитов `e15b2d0`, `30934b4`, `9b991a1`:
- Интерактивные команды `add` и `queue`
- Per-queue defaults (stages / retries / verification)
- Интерактивный `reset` с вариантами восстановления

---

## Подготовка

```bash
# Сборка
npm run build

# Тестовый проект (папка без orc-lite.json)
mkdir /tmp/orc-test && cd /tmp/orc-test
git init && git commit --allow-empty -m "init"
```

> Все команды ниже запускаются из `/tmp/orc-test` если не указано иное.

---

## 1. `orc-lite init` (переработан на inquirer)

### 1.1 Базовый сценарий

| Шаг | Действие | Ожидаемый результат |
|-----|----------|---------------------|
| 1 | `orc-lite init` | Запрос git strategy (select с тремя вариантами) |
| 2 | Выбрать `branch`, ввести `main` | Запрос tasks dir |
| 3 | Принять defaults для dirs | Запросы verification cmd и system prompt |
| 4 | Пропустить оба (Enter) | Запрос количества очередей |
| 5 | Ввести `2` | Для каждой очереди: name, dir, schedule, defaults |
| 6 | Для очереди 1: включить defaults → выбрать stages `implement+verify` | Ввод retries, backoff, verify cmd |
| 7 | Для очереди 2: отказаться от defaults | — |
| 8 | Завершить | `orc-lite.json` создан |

**Проверить в `orc-lite.json`:**
- `queues[0].stages = ["implement", "verify"]`
- `queues[1]` — нет полей stages / max_retries
- `git_strategy = "branch"`, `target_branch = "main"`

### 1.2 Повторный запуск

```bash
orc-lite init
```
Должен выдать ошибку: `orc-lite.json already exists`.

### 1.3 Git strategy = none

Выбрать `none` → поле `target_branch` не должно запрашиваться; в JSON `target_branch = ""`, `git_strategy = "none"`.

---

## 2. `orc-lite queue list`

### 2.1 Табличный вывод

После `init` с двумя очередями:

```bash
orc-lite queue list
```

**Проверить:**
- Заголовок: `#  Name  Dir  Tasks  Status`
- Очередь с defaults показывает в конце строки: `[stages: implement+verify, retries: N]`
- Очередь без defaults — без блока `[...]`
- Статус отображается цветом (`pending` — cyan, `done` — green, `failed` — red)

### 2.2 Нет очередей

Удалить все очереди из JSON → `orc-lite queue list` должен вывести `No queues defined.`

---

## 3. `orc-lite queue add`

### 3.1 Интерактивный режим (без имени)

```bash
orc-lite queue add
```

| Шаг | Вводить | Проверить |
|-----|---------|-----------|
| Queue name | `backend` | — |
| Tasks dir | Enter (принять global) | Не создаёт лишних полей `tasks_dir` |
| Schedule | Enter (пусто) | `schedule: null` в JSON |
| Configure defaults? | `y` | Появляется checkbox stages |
| Stages | `implement + test` | — |
| Max retries | `3` | Появляется запрос delay |
| Delay | `10` | Появляется выбор backoff |
| Backoff | `exponential` | — |
| Verify cmd | Enter | — |

**В JSON:**
```json
{
  "name": "backend",
  "stages": ["implement", "test"],
  "max_retries": 3,
  "retry": { "max_attempts": 3, "delay_seconds": 10, "backoff": "exponential" }
}
```

### 3.2 Флаговый режим

```bash
orc-lite queue add infra --dir ./infra-tasks --schedule "0 2 * * *"
```

Интерактив только для defaults. В JSON: `tasks_dir = "./infra-tasks"`, `schedule = "0 2 * * *"`.

### 3.3 Дубликат имени

Повторно `orc-lite queue add backend` → ошибка `Queue "backend" already exists`.

### 3.4 Несуществующая директория

Ввести несуществующую директорию → confirm "Create it?" → `y` → директория создана.
Повторить с `n` → директория не создана, очередь всё равно добавляется.

---

## 4. `orc-lite add` — интерактивный режим

### Подготовка

```bash
mkdir -p /tmp/orc-test/tasks
touch /tmp/orc-test/tasks/{feat-auth.md,fix-bug.md,refactor-db.md}
```

### 4.1 Базовый интерактивный add

```bash
orc-lite add
```

| Шаг | Действие | Проверить |
|-----|----------|-----------|
| 1 | Выбрать очередь через select | Список очередей с dir, task count, статусом |
| 2 | Выбрать `feat-auth.md` и `fix-bug.md` в checkbox | — |
| 3 | Configure options? → `n` | — |
| 4 | Завершить | 2 задачи добавлены в очередь, `.md` файлы существуют |

**В JSON:** две задачи `status: "pending"`, без лишних полей.

### 4.2 Добавление нового файла

```bash
orc-lite add
```

Выбрать `+ Enter new filename` → ввести `new-task.md` → файл создан по шаблону, задача добавлена.

### 4.3 Файл уже в очереди

В checkbox `feat-auth.md` должен показываться как `(already added)` и быть недоступен.

### 4.4 С настройкой опций

```bash
orc-lite add
```

Configure options? → `y`:
- Stages: выбрать `verify` → в JSON `task.stages = ["implement", "verify"]`
- Context files: `README.md, src/index.ts` → `task.context_files = ["README.md", "src/index.ts"]`
- Max retries: `2` → `task.max_retries = 2`

### 4.5 Quick add с `-q` по имени

```bash
orc-lite add new-task2.md -q backend
```

Задача добавлена в очередь `backend`, не в первую.

### 4.6 Quick add с `-q` по номеру

```bash
orc-lite add new-task3.md -q 1
```

Задача добавлена в очередь #1.

### 4.7 Очередь с собственным `tasks_dir`

Очередь `backend` с `tasks_dir = "./infra-tasks"`:
```bash
orc-lite add -q backend
```

Интерактив должен читать файлы из `./infra-tasks`, создавать файлы туда же.

---

## 5. Per-queue defaults — цепочка fallback в task-runner

Проверяется косвенно через содержимое JSON (task-runner использует fallback task → queue → global).

### 5.1 Приоритет: task > queue > global

Создать конфиг вручную:

```json
{
  "max_retries": 1,
  "queues": [{
    "name": "q1",
    "max_retries": 3,
    "stages": ["implement", "verify"],
    "status": "pending",
    "tasks": [
      { "file": "t1.md", "status": "pending" },
      { "file": "t2.md", "status": "pending", "max_retries": 5 }
    ]
  }]
}
```

Запустить в dry-run / проверить через логи:
- `t1.md`: max_retries должно быть **3** (queue), stages **implement → verify**
- `t2.md`: max_retries должно быть **5** (task)

### 5.2 verification_cmd уровня очереди

Добавить `"verification_cmd": "echo ok"` на уровне очереди, без глобального — задачи очереди должны использовать его.

### 5.3 retry backoff уровня очереди

Очередь с `"retry": { "backoff": "linear", "delay_seconds": 5 }` — задачи без своего retry должны использовать очередной.

---

## 6. `orc-lite reset` — интерактивный режим

### Подготовка

Добавить в JSON задачи с разными статусами:

```json
"tasks": [
  { "file": "task-fail.md", "status": "failed", "error": "timeout after 600s" },
  { "file": "task-stuck.md", "status": "in_progress" },
  { "file": "task-done.md", "status": "done" },
  { "file": "task-pending.md", "status": "pending" }
]
```

Статус очереди установить `"failed"`.

### 6.1 Отображение кандидатов

```bash
orc-lite reset
```

**Проверить:**
- Показаны только `task-fail.md` (failed) и `task-stuck.md` (in_progress / stuck)
- `task-done.md` и `task-pending.md` **не** показываются
- `task-fail.md` отображает снипет ошибки
- Badge цвет: `failed` = красный, `stuck` = жёлтый

### 6.2 Нет кандидатов

Установить все статусы `done`/`pending` → `orc-lite reset` выводит `No failed or stuck tasks found.`

### 6.3 Пустой выбор

Нажать Enter без выбора задач → `Nothing selected.`

### 6.4 Действие: Reset as-is

Выбрать `task-fail.md` → Action: `Reset (retry as-is)`:
- `status → pending`
- `error`, `started_at`, `completed_at`, `retry_count` очищены
- Статус очереди `failed → pending`

### 6.5 Действие: Bump timeout

Конфиг с `adapter_options.timeout = 300`.

Выбрать задачу → `Bump timeout (300s → 600s)`:
- Задача сброшена в `pending`
- `adapter_options.timeout = 600` в JSON

Повторный bump на второй задаче: `600 → 1200`.

### 6.6 Действие: Add retries

Текущий `max_retries = 1` (глобальный).

Выбрать задачу → `Add retries (currently 1)`:
- Default предложения = `max(1+2, 3) = 3`
- Ввести `5` → `task.max_retries = 5` в JSON

### 6.7 Действие: Change stages

Текущие stages `implement`.

Выбрать задачу → `Change stages` → снять `implement`, выбрать `verify + test`:
- В коде: `implement` всегда prepend → `stages = ["implement", "verify", "test"]`

**Пограничный случай:** выбрать только `implement` → stages не должны измениться на дефолт, должно быть `["implement"]`.

### 6.8 Действие: Mark as skipped

Выбрать задачу → `Mark as skipped`:
- `status = "skipped"`
- Все runtime-поля очищены
- Задача **не** сбрасывает очередь в pending

### 6.9 Несколько задач — разные действия

Выбрать обе (`task-fail.md`, `task-stuck.md`). Для первой — Reset, для второй — Skip. Оба изменения применены независимо.

---

## 7. `orc-lite reset <file>` — quick reset

### 7.1 Базовый quick reset

```bash
orc-lite reset task-fail.md
```

Задача сброшена в pending, вывод: `✓ Task "task-fail.md" reset to pending (queue: q1)`.

### 7.2 С флагом `-q` по имени

```bash
orc-lite reset task-fail.md -q q1
```

Ищет задачу только в очереди `q1`.

### 7.3 С флагом `-q` по номеру

```bash
orc-lite reset task-fail.md -q 1
```

### 7.4 Задача со статусом done

```bash
orc-lite reset task-done.md
```

Должна быть ошибка: `Task "task-done.md" is already done.` (exit code 1).

### 7.5 Несуществующая задача

```bash
orc-lite reset nonexistent.md
```

Ошибка: `Task not found: nonexistent.md` (exit code 1).

### 7.6 Несуществующая очередь

```bash
orc-lite reset task-fail.md -q nonexistent
```

Ошибка: `Queue "nonexistent" not found`.

---

## 8. Регрессионные проверки

| Команда | Что проверяем |
|---------|---------------|
| `orc-lite status` | Показывает задачи после интерактивного add |
| `orc-lite add task.md` | Quick add без `-q` выбирает первую не-done очередь |
| `orc-lite queue list` | После reset обновлённые статусы видны в таблице |
| `orc-lite reset task.md -q 2` | `-q` принимает и имя и номер очереди |
| Несколько очередей, одно имя файла | `orc-lite reset dup.md` без `-q` находит первое вхождение |

---

## 9. Крайние случаи

| Сценарий | Ожидание |
|----------|----------|
| `orc-lite add` без очередей | Ошибка / пустой список |
| `orc-lite queue add` — dir указан флагом, не задан интерактивно | Флаг имеет приоритет |
| `stages` в init: выбрать только `implement` | Поле `stages` не сохраняется (defaults не нужен) |
| `max_retries = 0` в queue defaults | Не создаёт `retry` объект |
| Прерывание Ctrl+C в середине интерактива | Нет частичных записей в JSON |
