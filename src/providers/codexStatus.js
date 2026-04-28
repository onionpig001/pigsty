import { spawn } from "node:child_process";

function requestAppServer(requests, timeoutMs = 15000, codexBin = "codex") {
  return new Promise((resolve, reject) => {
    const child = spawn(codexBin, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const responses = new Map();
    let buffer = "";
    let stderr = "";
    let nextIndex = 0;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex app-server status request timed out${stderr ? `: ${stderr}` : ""}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      child.kill("SIGTERM");
    }

    function sendNext() {
      if (nextIndex >= requests.length) {
        cleanup();
        resolve(responses);
        return;
      }
      const request = requests[nextIndex];
      nextIndex += 1;
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.error) {
          cleanup();
          reject(new Error(JSON.stringify(message.error)));
          return;
        }
        responses.set(message.id, message.result);
        sendNext();
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (responses.size >= requests.length) return;
      clearTimeout(timer);
      reject(new Error(`Codex app-server exited early: code=${code ?? "null"} signal=${signal ?? "none"} ${stderr}`));
    });

    sendNext();
  });
}

function percentageLeft(window) {
  if (!window) return null;
  return Math.max(0, Math.round(100 - window.usedPercent));
}

function bar(leftPercent) {
  if (leftPercent == null) return "";
  const total = 20;
  const filled = Math.round((leftPercent / 100) * total);
  return `[${"█".repeat(filled)}${"░".repeat(total - filled)}]`;
}

function formatReset(timestampSeconds) {
  if (!timestampSeconds) return "unknown";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestampSeconds * 1000));
}

function formatWindow(label, window) {
  const left = percentageLeft(window);
  if (left == null) return `${label}: unknown`;
  return `${label}: ${bar(left)} ${left}% left (resets ${formatReset(window.resetsAt)})`;
}

function formatLimit(snapshot, heading = "") {
  if (!snapshot) return "";
  const title = heading || snapshot.limitName || snapshot.limitId || "Codex";
  return [
    title,
    formatWindow("5h limit", snapshot.primary),
    formatWindow("Weekly limit", snapshot.secondary)
  ].join("\n");
}

export async function getCodexStatus(config) {
  const initialize = {
    id: 1,
    method: "initialize",
    params: {
      clientInfo: {
        name: "pigsty",
        title: "Pigsty",
        version: "0.1.0"
      },
      capabilities: { experimentalApi: true }
    }
  };
  const responses = await requestAppServer([
    initialize,
    { id: 2, method: "account/read", params: { refreshToken: true } },
    {
      id: 3,
      method: "config/read",
      params: { includeLayers: false, cwd: config.provider.workspaceDir }
    },
    { id: 4, method: "account/rateLimits/read" }
  ], 15000, config.provider.codexBin);

  const init = responses.get(1);
  const account = responses.get(2)?.account;
  const codexConfig = responses.get(3)?.config || {};
  const limits = responses.get(4);
  const primaryLimits = limits?.rateLimits;
  const sparkLimits = limits?.rateLimitsByLimitId?.codex_bengalfox;

  return [
    "OpenAI Codex",
    "",
    "Visit https://chatgpt.com/codex/settings/usage for up-to-date information on rate limits and credits",
    "",
    `Model: ${codexConfig.model || config.provider.codexModel || "default"}${codexConfig.model_reasoning_effort ? ` (reasoning ${codexConfig.model_reasoning_effort})` : ""}`,
    `Directory: ${config.provider.workspaceDir}`,
    `Permissions: ${codexConfig.sandbox_mode || config.provider.codexSandbox}${codexConfig.approval_policy ? `, ${codexConfig.approval_policy}` : ""}`,
    `Account: ${account?.type === "chatgpt" ? `${account.email} (${account.planType})` : account?.type || "unknown"}`,
    `Codex home: ${init?.codexHome || "unknown"}`,
    "",
    formatLimit(primaryLimits, primaryLimits?.limitName || "Codex limit"),
    sparkLimits ? `\n${formatLimit(sparkLimits, sparkLimits.limitName || "GPT-5.3-Codex-Spark limit")}` : "",
    "",
    "Context window is only available for the active TUI thread; Telegram bridge reads account/config/rate-limit status through app-server."
  ].filter(Boolean).join("\n");
}
