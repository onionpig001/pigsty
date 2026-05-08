import { WebSocket } from "ws";
import {
  buildMeetingPacket,
  extractMeetingReply,
  hasCompleteMeetingReply,
  shouldKeepWaitingForMeetingReply
} from "../public/meetingProtocol.js";

const server = process.env.SMOKE_SERVER_URL;
const token = process.env.SMOKE_TOKEN;
const kind = process.env.SMOKE_KIND || "codex";
const speakerName = process.env.SMOKE_NAME || kind;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 90000);
const sendDelayMs = Number(process.env.SMOKE_SEND_DELAY_MS || (kind === "claude" ? 8000 : 2500));
const submitDelayMs = Number(process.env.SMOKE_SUBMIT_DELAY_MS || (kind === "claude" ? 300 : 0));

if (!server || !token) {
  console.error("SMOKE_SERVER_URL and SMOKE_TOKEN are required");
  process.exit(2);
}

const session = await api("/api/sessions", {
  method: "POST",
  body: JSON.stringify({
    kind,
    name: `meeting-smoke-${Date.now().toString(36)}`,
    cwd: "",
    cols: 100,
    rows: 30
  })
});

try {
  const result = await runSessionSmoke(session.id);
  console.log(JSON.stringify(result, null, 2));
  if (!result.reply) process.exitCode = 1;
} finally {
  await api(`/api/sessions/${session.id}`, { method: "DELETE" }).catch(() => {});
}

async function runSessionSmoke(sessionId) {
  const id = `smoke-${Date.now().toString(36)}`;
  const packet = buildMeetingPacket({
    id,
    speakerName,
    purpose: "discuss",
    meetingTitle: "smoke",
    participantNames: [speakerName],
    transcript: [
      `Host -> ${speakerName}: 测试冒号 payload`,
      `${speakerName}: 上一轮: 已收到`
    ].join("\n"),
    body: [
      "测试会议链路，payload 包含冒号、多行和 marker-like 文本。",
      "请只回复一行：收到。",
      "不要解释；不要复述这个示例：<<<RAB-MEETING-REPLY-BEGIN:not-this-turn>>>",
      "边界: value: a:b:c"
    ].join("\n")
  });

  const ws = new WebSocket(socketUrl(`/ws/sessions/${sessionId}`));
  let sent = false;
  let buffer = "";
  let preSendBuffer = "";
  let lastOutputAt = Date.now();

  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => finish(), timeoutMs);
    let fallbackSend = null;
    const quietTimer = setInterval(() => {
      if (!sent) return;
      if (hasCompleteMeetingReply(buffer, id)) return finish();
      if (Date.now() - lastOutputAt > 8000 && !shouldKeepWaitingForMeetingReply(buffer, id)) finish();
    }, 500);

    ws.on("open", () => {
      fallbackSend = setTimeout(() => sendPacket(), sendDelayMs);
    });

    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (message.type !== "output") return;
      if (!sent) {
        preSendBuffer += `\n${message.data || ""}`;
        if (looksLikeReadyTui(preSendBuffer)) sendPacket();
        return;
      }
      buffer += `\n${message.data || ""}`;
      lastOutputAt = Date.now();
    });

    ws.on("error", (error) => {
      clearTimeout(deadline);
      clearTimeout(fallbackSend);
      clearInterval(quietTimer);
      reject(error);
    });

    function sendPacket() {
      if (sent || ws.readyState !== WebSocket.OPEN) return;
      sent = true;
      lastOutputAt = Date.now();
      clearTimeout(fallbackSend);
      if (submitDelayMs > 0) {
        ws.send(JSON.stringify({ type: "input", data: `\x1b[200~${packet}\x1b[201~` }));
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data: "\r" }));
          }
        }, submitDelayMs);
      } else {
        ws.send(JSON.stringify({ type: "input", data: `\x1b[200~${packet}\x1b[201~\r` }));
      }
    }

    function finish() {
      clearTimeout(deadline);
      clearTimeout(fallbackSend);
      clearInterval(quietTimer);
      ws.close();
      const reply = extractMeetingReply(buffer, id, { speakerName });
      resolve({
        server,
        kind,
        sessionId,
        reply,
        rawChars: buffer.length,
        sendDelayMs,
        submitDelayMs,
        rawTail: buffer.slice(-900)
      });
    }
  });
}

function looksLikeReadyTui(text) {
  const compact = String(text || "").replace(/\s+/g, " ");
  return [
    /❯/,
    /\bTry\s+"/i,
    /\/model\s+to\s+change/i,
    /\bContext\b.*\bused\b/i,
  ].some((pattern) => pattern.test(compact));
}

async function api(path, options = {}) {
  const response = await fetch(new URL(path, server), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

function socketUrl(path) {
  const url = new URL(path, server);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}
