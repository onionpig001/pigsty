# Pigsty

Pigsty is a personal AI agent farm for routing messages, tasks, and automations from chat channels to local workers.

It currently ships with Telegram long polling, a generic HTTP webhook, a mock provider for demos, and a Codex CLI provider. The provider layer is intentionally small so future workers can be added without renaming the project or coupling it to one model.

## Features

- Telegram Bot long polling, no public webhook required.
- Telegram user allowlist.
- HTTP webhook for other chat or automation systems.
- Persistent task queue with `pending_approval`, `queued`, `running`, `completed`, `failed`, and `cancelled` states.
- Mock provider for local demos.
- Codex provider through `codex exec`.
- Local output archive per task.

## Quick Start

```bash
cp .env.example .env
npm run demo
npm start
```

Health check:

```bash
curl -s http://127.0.0.1:4188/health
```

## Telegram Setup

1. Create a bot with `@BotFather`.
2. Put the token in `.env` as `TELEGRAM_BOT_TOKEN`.
3. Start Pigsty and send `/whoami` to the bot.
4. Put your numeric user id in `TELEGRAM_ALLOWED_USER_IDS`.
5. Restart the service.

Commands:

```text
plain text             create or run a task, depending on configuration
/whoami                show Telegram user id and chat id
/bridge_help           show bridge help
/bridge_task <prompt>  create a task
/bridge_run <task id>  run a pending task
/bridge_quick <prompt> create and run immediately when AUTO_RUN=true
/bridge_status [id]    show task status
/bridge_tasks          show recent tasks
/bridge_cancel <id>    cancel pending/queued/running task
```

## Codex Provider

Example `.env`:

```bash
AGENT_PROVIDER=codex
WORKSPACE_DIR=./workspace
CODEX_BIN=/usr/local/bin/codex
CODEX_SANDBOX=workspace-write
AUTO_RUN=true
PLAIN_TEXT_AS_TASK=true
CONVERSATIONAL_MODE=true
```

`CODEX_BIN` may be either `codex` or an absolute path. Use an absolute path when running under `launchd`, systemd, cron, or another restricted environment.

Avoid `danger-full-access` for remote chat entrypoints. Use a trusted user allowlist, a constrained workspace, and persistent logs.

## Webhook

Request header:

```text
Authorization: Bearer <WEBHOOK_TOKEN>
```

Request body:

```json
{
  "channel": "feishu",
  "userId": "owner",
  "chatId": "chat-1",
  "text": "Write a release note"
}
```

Endpoint:

```text
POST /webhook/message
```

## Data Layout

- `data/tasks.json` — task state, ignored by Git.
- `data/state.json` — Telegram offset and runtime state, ignored by Git.
- `outputs/<task-id>/` — task output archive, ignored by Git.
- `workspace/` — worker workspace, ignored by Git except `.gitkeep`.

## macOS LaunchAgent

For a user-level LaunchAgent, prefer an absolute Node path and set `PATH`:

```xml
<key>ProgramArguments</key>
<array>
  <string>/usr/local/bin/node</string>
  <string>src/index.js</string>
</array>
<key>WorkingDirectory</key>
<string>/path/to/pigsty</string>
<key>EnvironmentVariables</key>
<dict>
  <key>PATH</key>
  <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  <key>HOME</key>
  <string>/Users/you</string>
</dict>
```

## Security Notes

- Never commit `.env`.
- Keep `TELEGRAM_ALLOWED_USER_IDS` set for any real bot.
- Treat chat-triggered task execution as a privileged remote control surface.
- Keep `WORKSPACE_DIR` scoped to a safe directory.

