import { readJson, writeJson } from "../utils/jsonStore.js";
import { paths } from "../config.js";

export class TelegramChannel {
  constructor({ config, router }) {
    this.config = config;
    this.router = router;
    this.botToken = config.telegram.botToken;
    this.running = false;
  }

  apiUrl(method) {
    return `https://api.telegram.org/bot${this.botToken}/${method}`;
  }

  async call(method, body = {}) {
    const response = await fetch(this.apiUrl(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(`Telegram ${method} failed: ${JSON.stringify(data)}`);
    }
    return data.result;
  }

  async sendMessage(chatId, text) {
    if (!this.botToken) return;
    const chunks = chunkText(text, 3900);
    for (const chunk of chunks) {
      await this.call("sendMessage", {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true
      });
    }
  }

  async sendTyping(chatId) {
    if (!this.botToken) return;
    await this.call("sendChatAction", {
      chat_id: chatId,
      action: "typing"
    });
  }

  startTyping(chatId) {
    if (!this.botToken) return () => {};
    let stopped = false;
    const ping = () => {
      if (stopped) return;
      this.sendTyping(chatId).catch((error) => {
        console.error(`telegram typing failed: ${error.message}`);
      });
    };
    ping();
    const timer = setInterval(ping, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  getOffset() {
    const state = readJson(paths.state, {});
    return state.telegramOffset || 0;
  }

  setOffset(offset) {
    const state = readJson(paths.state, {});
    writeJson(paths.state, { ...state, telegramOffset: offset });
  }

  start() {
    if (!this.botToken || !this.config.telegram.polling) return;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      try {
        const updates = await this.call("getUpdates", {
          offset: this.getOffset(),
          timeout: 30,
          allowed_updates: ["message"]
        });
        for (const update of updates) {
          this.setOffset(update.update_id + 1);
          await this.handleUpdate(update);
        }
      } catch (error) {
        console.error(`telegram polling failed: ${error.message}`);
        const isConflict = error.message.includes('"error_code":409');
        await delay(isConflict ? 30000 : 3000);
      }
    }
  }

  async handleUpdate(update) {
    const message = update.message;
    if (!message?.chat?.id) return;

    const normalized = {
      channel: "telegram",
      chatId: String(message.chat.id),
      userId: String(message.from?.id || ""),
      text: message.text || message.caption || "",
      raw: message
    };
    const reply = await this.router.handle(normalized);
    if (reply) {
      await this.sendMessage(normalized.chatId, reply);
    }
  }
}

function chunkText(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  chunks.push(remaining);
  return chunks;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
