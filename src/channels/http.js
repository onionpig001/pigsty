import { createServer } from "node:http";

export class HttpChannel {
  constructor({ config, router, store }) {
    this.config = config;
    this.router = router;
    this.store = store;
    this.server = null;
  }

  start() {
    const { host, port } = this.config;
    this.server = createServer((req, res) => this.handle(req, res));
    this.server.listen(port, host, () => {
      console.log(`Pigsty running at http://${host}:${port}`);
    });
  }

  stop() {
    this.server?.close();
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, `http://${this.config.host}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, {
          ok: true,
          provider: this.config.provider.name,
          telegramConfigured: Boolean(this.config.telegram.botToken),
          allowedTelegramUsers: this.config.telegram.allowedUserIds.length,
          tasks: this.store.list().length
        });
      }

      if (req.method === "GET" && url.pathname === "/tasks") {
        return sendJson(res, 200, this.store.recent(50));
      }

      if (req.method === "POST" && url.pathname === "/webhook/message") {
        if (!this.config.webhookChannelEnabled) return sendJson(res, 404, { error: "webhook disabled" });
        if (!this.authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
        const body = await readBody(req);
        const reply = await this.router.handle({
          channel: body.channel || "webhook",
          chatId: String(body.chatId || body.userId || "webhook"),
          userId: String(body.userId || "webhook"),
          text: String(body.text || ""),
          raw: body
        });
        return sendJson(res, 200, { reply });
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  }

  authorized(req) {
    if (!this.config.webhookToken) return false;
    return req.headers.authorization === `Bearer ${this.config.webhookToken}`;
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(value)}\n`);
}
