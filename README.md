# Pigsty

Pigsty is a personal AI agent farm for routing messages, tasks, and automations from chat channels to local workers.

It currently ships with Telegram long polling, a generic HTTP webhook, a mock provider for demos, and a Codex CLI provider. The provider layer is intentionally small so future workers can be added without renaming the project or coupling it to one model.

## Features

- Telegram Bot long polling, no public webhook required.
- Telegram user allowlist.
- HTTP webhook for other chat or automation systems.
- Natural-language task routing from chat messages.
- Slash passthrough: `/status`, `/model`, `/help`, and other worker-level slash commands are forwarded to the configured worker instead of being interpreted by Pigsty.
- Persistent task queue with `queued`, `running`, `completed`, `failed`, and `cancelled` states.
- Mock provider for local demos.
- Codex provider through `codex exec`.
- Local output archive per task.
- Mobile-friendly Web TUI console for live Codex and Claude Code sessions.

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

## Web TUI Console

The web console runs on the same HTTP port as the API. It starts real PTY-backed
Codex or Claude Code TUI sessions on the server, keeps multiple sessions alive
while the service is running, and lets a phone browser attach to any session.

Local setup:

```bash
cp .env.example .env
npm install
npm start
```

Open:

```text
http://127.0.0.1:4188/
```

For phone access on the same LAN:

```bash
HOST=0.0.0.0
WEB_UI_TOKEN=<long-random-token>
WEB_TUI_DEFAULT_CWD=..
WEB_TUI_ALLOWED_CWD_ROOTS=..
```

Then open:

```text
http://<server-lan-ip>:4188/
```

Security notes for the TUI console:

- The web console is a privileged remote control surface for your server user.
- Always set `WEB_UI_TOKEN` before binding to `0.0.0.0`.
- Prefer a VPN or private network for remote internet access.
- Keep `WEB_TUI_ALLOWED_CWD_ROOTS` constrained to directories you expect AI TUI sessions to edit.

The later Android and iOS apps can reuse the same API and WebSocket protocol:
`GET /api/bootstrap`, `POST /api/sessions`, and `WS /ws/sessions/:id`.

### Bring Your Own AI Server

Pigsty can be used as a client/server product without running other people's AI
sessions on a central machine:

1. Each user installs this backend on their own Mac, Linux server, or home host.
2. Their backend runs `codex`, `claude`, or another configured TUI inside a real
   PTY on their own filesystem.
3. The web/mobile client stores connection profiles: server URL, token, display
   name, and optional default workspace.
4. The client connects directly to that user's backend over HTTPS/WSS, VPN, LAN,
   or a private tunnel such as Tailscale/Cloudflare Tunnel.
5. One client can save multiple server profiles and switch between them. Each
   server owns its own session list because sessions live in that server's PTY
   manager.

The backend auto-detects local TUI commands on startup and on each bootstrap
request. If `codex` is installed, Codex appears. If `claude` is installed,
Claude Code appears. If a command is missing, the backend does not advertise it
to the client.

For a hosted web client or future mobile app, `WEB_UI_ALLOWED_ORIGINS` defaults
to `*` so one web client can call multiple user backends. For stricter public
deployments, set exact CORS origins on the user's backend:

```bash
WEB_UI_ALLOWED_ORIGINS=https://app.example.com
```

Native Android and iOS clients can use the same URL/token model without browser
CORS limits. For internet-facing use, put the backend behind HTTPS, keep a strong
`WEB_UI_TOKEN`, and avoid exposing raw HTTP directly to the public internet.

## Telegram Setup

1. Create a bot with `@BotFather`.
2. Put the token in `.env` as `TELEGRAM_BOT_TOKEN`.
3. Start Pigsty and send `/whoami` to the bot.
4. Put your numeric user id in `TELEGRAM_ALLOWED_USER_IDS`.
5. Restart the service.

Telegram is intentionally minimal. Pigsty exposes only one setup command:

```text
/whoami                show Telegram user id and chat id
```

After allowlist setup, send natural language directly. Pigsty turns the message into a task and replies with the worker's result. Messages that start with `/` are passed through unchanged to the worker, except `/whoami`.

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
