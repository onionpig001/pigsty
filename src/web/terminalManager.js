import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import { delimiter, isAbsolute, relative, resolve } from "node:path";
import * as pty from "node-pty";

const MAX_SCROLLBACK_BYTES = 1_000_000;

export class TerminalManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.sessions = new Map();
  }

  listTools() {
    const tools = [
      {
        id: "codex",
        label: "Codex",
        command: this.config.webUi.codexBin,
        args: this.config.webUi.codexArgs
      },
      {
        id: "claude",
        label: "Claude Code",
        command: this.config.webUi.claudeBin,
        args: this.config.webUi.claudeArgs
      }
    ].filter((tool) => commandAvailable(tool.command));

    if (this.config.webUi.allowShell && commandAvailable(this.config.webUi.shellBin)) {
      tools.push({
        id: "shell",
        label: "Shell",
        command: this.config.webUi.shellBin,
        args: this.config.webUi.shellArgs
      });
    }

    return tools;
  }

  listSessions() {
    return [...this.sessions.values()]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map((session) => this.serialize(session));
  }

  get(id) {
    return this.sessions.get(id);
  }

  serialize(session) {
    return {
      id: session.id,
      name: session.name,
      kind: session.kind,
      label: session.label,
      cwd: session.cwd,
      command: session.command,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      exitCode: session.exitCode,
      signal: session.signal
    };
  }

  create({ kind = "codex", name = "", cwd = "", cols = 100, rows = 30 } = {}) {
    if (this.sessions.size >= this.config.webUi.maxSessions) {
      throw new Error(`Maximum TUI sessions reached: ${this.config.webUi.maxSessions}`);
    }

    const tool = this.listTools().find((item) => item.id === kind);
    if (!tool) throw new Error(`Unsupported TUI kind: ${kind}`);

    const normalizedCwd = this.normalizeCwd(cwd || this.config.webUi.defaultCwd);
    mkdirSync(normalizedCwd, { recursive: true });

    const id = randomUUID();
    const now = new Date().toISOString();
    const safeCols = clamp(Number(cols) || 100, 40, 240);
    const safeRows = clamp(Number(rows) || 30, 12, 80);
    const term = pty.spawn(tool.command, tool.args, {
      name: "xterm-256color",
      cols: safeCols,
      rows: safeRows,
      cwd: normalizedCwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor"
      }
    });

    const session = {
      id,
      name: name.trim() || `${tool.label} ${id.slice(0, 6)}`,
      kind,
      label: tool.label,
      command: [tool.command, ...tool.args].join(" "),
      cwd: normalizedCwd,
      status: "running",
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      signal: null,
      term,
      scrollback: "",
      dataDisposable: null,
      exitDisposable: null
    };

    session.dataDisposable = term.onData((data) => {
      session.updatedAt = new Date().toISOString();
      session.scrollback = trimScrollback(session.scrollback + data);
      this.emit(`data:${id}`, data);
      this.emit("change", this.serialize(session));
    });

    session.exitDisposable = term.onExit(({ exitCode, signal }) => {
      session.status = "exited";
      session.exitCode = exitCode;
      session.signal = signal;
      session.updatedAt = new Date().toISOString();
      this.emit(`exit:${id}`, this.serialize(session));
      this.emit("change", this.serialize(session));
    });

    this.sessions.set(id, session);
    this.emit("change", this.serialize(session));
    return this.serialize(session);
  }

  write(id, data) {
    const session = this.requireRunning(id);
    session.term.write(data);
    session.updatedAt = new Date().toISOString();
  }

  resize(id, cols, rows) {
    const session = this.requireRunning(id);
    const safeCols = clamp(Number(cols) || 100, 20, 300);
    const safeRows = clamp(Number(rows) || 30, 8, 120);
    session.term.resize(safeCols, safeRows);
    session.updatedAt = new Date().toISOString();
  }

  kill(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.status === "running") session.term.kill();
    return true;
  }

  remove(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.status === "running") session.term.kill();
    session.dataDisposable?.dispose();
    session.exitDisposable?.dispose();
    this.sessions.delete(id);
    this.emit("remove", id);
    return true;
  }

  stopAll() {
    for (const id of this.sessions.keys()) {
      this.remove(id);
    }
  }

  normalizeCwd(input) {
    const fallbackRoot = this.config.webUi.defaultCwd;
    const requested = isAbsolute(input) ? resolve(input) : resolve(fallbackRoot, input);
    const roots = this.config.webUi.allowedCwdRoots.length
      ? this.config.webUi.allowedCwdRoots
      : [fallbackRoot];

    const allowed = roots.some((root) => isInsidePath(requested, root));
    if (!allowed) {
      throw new Error(`Directory is outside allowed roots: ${requested}`);
    }

    const stats = statSync(requested, { throwIfNoEntry: false });
    if (stats && !stats.isDirectory()) {
      throw new Error(`Not a directory: ${requested}`);
    }

    return requested;
  }

  requireRunning(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`TUI session not found: ${id}`);
    if (session.status !== "running") throw new Error(`TUI session is not running: ${id}`);
    return session;
  }
}

function trimScrollback(value) {
  if (Buffer.byteLength(value, "utf8") <= MAX_SCROLLBACK_BYTES) return value;
  return value.slice(Math.floor(value.length / 2));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isInsidePath(child, parent) {
  const diff = relative(resolve(parent), child);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

function commandAvailable(command) {
  if (!command) return false;

  if (command.includes("/")) {
    const path = isAbsolute(command) ? command : resolve(command);
    return executable(path);
  }

  for (const dir of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    if (executable(resolve(dir, command))) return true;
  }

  return false;
}

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
