import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { boolEnv, listEnv, loadEnv } from "./utils/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const rootDir = resolve(__dirname, "..");

loadEnv(rootDir);

function loadPolicies() {
  const path = resolve(rootDir, "config/policies.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

const policies = loadPolicies();
const generatedWebUiToken = randomBytes(24).toString("base64url");

function argsEnv(name) {
  const raw = process.env[name] || "";
  if (!raw.trim()) return [];

  if (raw.trim().startsWith("[")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array when it starts with [`);
    return parsed.map(String);
  }

  return raw.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function pathEnv(name, fallback) {
  const value = process.env[name] || fallback;
  return resolve(rootDir, value);
}

export const paths = {
  root: rootDir,
  public: resolve(rootDir, "public"),
  dataDir: resolve(rootDir, "data"),
  tasks: resolve(rootDir, "data/tasks.json"),
  state: resolve(rootDir, "data/state.json"),
  outputs: resolve(rootDir, "outputs"),
  workspace: resolve(rootDir, process.env.WORKSPACE_DIR || "./workspace")
};

export function runtimeConfig() {
  const allowedTelegramUserIds = listEnv("TELEGRAM_ALLOWED_USER_IDS");
  const webUiAllowedOrigins = listEnv("WEB_UI_ALLOWED_ORIGINS");

  return {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 4188),
    webhookToken: process.env.WEBHOOK_TOKEN || "",
    webhookChannelEnabled: boolEnv("WEBHOOK_CHANNEL_ENABLED", true),
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
      polling: boolEnv("TELEGRAM_POLLING", true),
      allowedUserIds: allowedTelegramUserIds
    },
    tasks: {
      autoRun: boolEnv("AUTO_RUN", false),
      plainTextAsTask: boolEnv("PLAIN_TEXT_AS_TASK", Boolean(policies.security?.allowPlainTextAsTask)),
      conversationalMode: boolEnv("CONVERSATIONAL_MODE", true),
      maxActive: Number(process.env.MAX_ACTIVE_TASKS || 1),
      timeoutMs: Number(process.env.TASK_TIMEOUT_MS || 1_800_000),
      maxPromptLength: Number(policies.taskDefaults?.maxPromptLength || 12_000),
      resultPreviewLength: Number(policies.taskDefaults?.resultPreviewLength || 3200)
    },
    provider: {
      name: process.env.AGENT_PROVIDER || "mock",
      codexBin: process.env.CODEX_BIN || "codex",
      codexModel: process.env.CODEX_MODEL || "",
      codexProfile: process.env.CODEX_PROFILE || "",
      codexSandbox: process.env.CODEX_SANDBOX || "workspace-write",
      codexFullAuto: boolEnv("CODEX_FULL_AUTO", false),
      workspaceDir: paths.workspace
    },
    webUi: {
      enabled: boolEnv("WEB_UI_ENABLED", true),
      token: process.env.WEB_UI_TOKEN || generatedWebUiToken,
      tokenGenerated: !process.env.WEB_UI_TOKEN,
      allowedOrigins: webUiAllowedOrigins.length ? webUiAllowedOrigins : ["*"],
      defaultCwd: pathEnv("WEB_TUI_DEFAULT_CWD", ".."),
      allowedCwdRoots: listEnv("WEB_TUI_ALLOWED_CWD_ROOTS").map((path) => resolve(rootDir, path)),
      maxSessions: Number(process.env.WEB_TUI_MAX_SESSIONS || 8),
      codexBin: process.env.WEB_TUI_CODEX_BIN || process.env.CODEX_BIN || "codex",
      codexArgs: argsEnv("WEB_TUI_CODEX_ARGS"),
      claudeBin: process.env.WEB_TUI_CLAUDE_BIN || "claude",
      claudeArgs: argsEnv("WEB_TUI_CLAUDE_ARGS"),
      allowShell: boolEnv("WEB_TUI_ALLOW_SHELL", false),
      shellBin: process.env.WEB_TUI_SHELL_BIN || process.env.SHELL || "/bin/bash",
      shellArgs: argsEnv("WEB_TUI_SHELL_ARGS")
    },
    policies
  };
}
