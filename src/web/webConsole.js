import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { paths } from "../config.js";

const vendorFiles = new Map([
  ["/vendor/xterm.css", resolve(paths.root, "node_modules/@xterm/xterm/css/xterm.css")],
  ["/vendor/xterm.mjs", resolve(paths.root, "node_modules/@xterm/xterm/lib/xterm.mjs")],
  ["/vendor/addon-fit.mjs", resolve(paths.root, "node_modules/@xterm/addon-fit/lib/addon-fit.mjs")]
]);

export class WebConsole {
  constructor({ config, terminalManager }) {
    this.config = config;
    this.terminalManager = terminalManager;
    this.wss = null;
  }

  attach(server) {
    if (!this.config.webUi.enabled) return;
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url, `http://${req.headers.host || this.config.host}`);
      const match = url.pathname.match(/^\/ws\/sessions\/([^/]+)$/);
      if (!match) return socket.destroy();

      if (!this.originAllowed(req)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        return socket.destroy();
      }

      if (!this.authorized(req, url)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return socket.destroy();
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.handleSocket(ws, match[1]);
      });
    });
  }

  stop() {
    this.wss?.close();
  }

  printAccessInfo() {
    if (!this.config.webUi.enabled) return;
    console.log(`Web TUI console: http://${this.config.host}:${this.config.port}/`);
    if (this.config.webUi.tokenGenerated) {
      console.log(`Generated WEB_UI_TOKEN for this run: ${this.config.webUi.token}`);
    }
  }

  async handle(req, res) {
    if (!this.config.webUi.enabled) return false;

    const url = new URL(req.url, `http://${req.headers.host || this.config.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return sendFile(res, resolve(paths.public, "index.html"));
    }

    if (req.method === "GET" && url.pathname === "/app.js") {
      return sendFile(res, resolve(paths.public, "app.js"));
    }

    if (req.method === "GET" && url.pathname === "/meetingProtocol.js") {
      return sendFile(res, resolve(paths.public, "meetingProtocol.js"));
    }

    if (req.method === "GET" && url.pathname === "/styles.css") {
      return sendFile(res, resolve(paths.public, "styles.css"));
    }

    if (req.method === "GET" && vendorFiles.has(url.pathname)) {
      return sendFile(res, vendorFiles.get(url.pathname));
    }

    if (url.pathname.startsWith("/api/")) {
      if (!this.originAllowed(req)) return this.sendJson(req, res, 403, { error: "origin not allowed" });
      if (req.method === "OPTIONS") return this.sendEmpty(req, res, 204);
      if (!this.authorized(req, url)) return this.sendJson(req, res, 401, { error: "unauthorized" });
      return this.handleApi(req, res, url);
    }

    return false;
  }

  async handleApi(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      return this.sendJson(req, res, 200, {
        defaultCwd: this.config.webUi.defaultCwd,
        maxSessions: this.config.webUi.maxSessions,
        tokenGenerated: this.config.webUi.tokenGenerated,
        tools: this.terminalManager.listTools().map(({ id, label }) => ({ id, label })),
        sessions: this.terminalManager.listSessions()
      });
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      return this.sendJson(req, res, 200, this.terminalManager.listSessions());
    }

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const body = await readBody(req);
      const session = this.terminalManager.create({
        kind: String(body.kind || "codex"),
        name: String(body.name || ""),
        cwd: String(body.cwd || ""),
        cols: Number(body.cols || 100),
        rows: Number(body.rows || 30)
      });
      return this.sendJson(req, res, 201, session);
    }

    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(kill))?$/);
    if (match && req.method === "DELETE" && !match[2]) {
      const removed = this.terminalManager.remove(match[1]);
      return this.sendJson(req, res, removed ? 200 : 404, {
        ok: removed,
        id: match[1],
        error: removed ? undefined : "session not found"
      });
    }

    if (match && req.method === "POST" && match[2] === "kill") {
      const killed = this.terminalManager.kill(match[1]);
      return this.sendJson(req, res, killed ? 200 : 404, {
        ok: killed,
        id: match[1],
        error: killed ? undefined : "session not found"
      });
    }

    return this.sendJson(req, res, 404, { error: "not found" });
  }

  handleSocket(ws, sessionId) {
    const session = this.terminalManager.get(sessionId);
    if (!session) {
      ws.close(1008, "session not found");
      return;
    }

    sendWs(ws, {
      type: "snapshot",
      session: this.terminalManager.serialize(session),
      data: session.scrollback
    });

    const onData = (data) => sendWs(ws, { type: "output", data });
    const onExit = (next) => sendWs(ws, { type: "status", session: next });
    const onChange = (next) => {
      if (next.id === sessionId) sendWs(ws, { type: "status", session: next });
    };
    const onRemove = (id) => {
      if (id === sessionId) ws.close(1000, "session removed");
    };

    this.terminalManager.on(`data:${sessionId}`, onData);
    this.terminalManager.on(`exit:${sessionId}`, onExit);
    this.terminalManager.on("change", onChange);
    this.terminalManager.on("remove", onRemove);

    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString("utf8"));
        if (message.type === "input") this.terminalManager.write(sessionId, String(message.data || ""));
        if (message.type === "resize") this.terminalManager.resize(sessionId, message.cols, message.rows);
      } catch (error) {
        sendWs(ws, { type: "error", error: error.message });
      }
    });

    ws.on("close", () => {
      this.terminalManager.off(`data:${sessionId}`, onData);
      this.terminalManager.off(`exit:${sessionId}`, onExit);
      this.terminalManager.off("change", onChange);
      this.terminalManager.off("remove", onRemove);
    });
  }

  authorized(req, url) {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const token = bearer || url.searchParams.get("token") || "";
    return safeEqual(token, this.config.webUi.token);
  }

  originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;

    const host = req.headers.host;
    if (host) {
      const current = new URL(`http://${host}`);
      const candidate = new URL(origin);
      if (candidate.host === current.host) return true;
    }

    const allowed = this.config.webUi.allowedOrigins;
    return allowed.includes("*") || allowed.includes(origin);
  }

  corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !this.originAllowed(req)) return {};

    return {
      "Access-Control-Allow-Origin": this.config.webUi.allowedOrigins.includes("*") ? "*" : origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
  }

  sendJson(req, res, statusCode, value) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...this.corsHeaders(req)
    });
    res.end(`${JSON.stringify(value)}\n`);
    return true;
  }

  sendEmpty(req, res, statusCode) {
    res.writeHead(statusCode, this.corsHeaders(req));
    res.end();
    return true;
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendFile(res, path) {
  const content = readFileSync(path);
  res.writeHead(200, {
    "Content-Type": contentType(path),
    "Cache-Control": "no-store"
  });
  res.end(content);
  return true;
}

function sendWs(ws, value) {
  if (ws.readyState === 1) ws.send(JSON.stringify(value));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function contentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}
