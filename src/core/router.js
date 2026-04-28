export class MessageRouter {
  constructor({ store, runner, config }) {
    this.store = store;
    this.runner = runner;
    this.config = config;
  }

  isAllowed(message) {
    if (message.channel !== "telegram") return true;
    const allowed = this.config.telegram.allowedUserIds;
    if (!allowed.length) return false;
    return allowed.includes(String(message.userId));
  }

  createTask(message, prompt, options = {}) {
    const trimmed = prompt.trim();
    if (!trimmed) return "任务内容不能为空。";
    if (trimmed.length > this.config.tasks.maxPromptLength) {
      return `任务太长，当前限制 ${this.config.tasks.maxPromptLength} 字符。`;
    }

    const task = this.store.create({
      prompt: trimmed,
      channel: message.channel,
      chatId: message.chatId,
      userId: message.userId,
      delivery: {
        style: options.conversational ? "conversation" : "task"
      }
    });

    if (!this.config.tasks.autoRun) {
      return [
        "我已收到这条消息，但当前 AUTO_RUN=false，所以不会从聊天入口直接执行。",
        "如果这是你的私人 bot，把 .env 里的 AUTO_RUN=true 和 PLAIN_TEXT_AS_TASK=true 打开后重启 Pigsty。"
      ].join("\n");
    }

    this.runner.enqueue(task.id);
    return options.conversational ? "" : `已排队：${task.id.slice(0, 8)}`;
  }

  createConversationalTask(message, text) {
    const conversational =
      message.channel === "telegram" &&
      this.config.tasks.conversationalMode;
    return this.createTask(message, text, { conversational });
  }

  async handle(message) {
    const text = (message.text || "").trim();
    if (!text) return "";

    if (text === "/whoami") {
      return [
        `channel=${message.channel}`,
        `userId=${message.userId}`,
        `chatId=${message.chatId}`,
        "把 userId 写入 TELEGRAM_ALLOWED_USER_IDS 后重启服务。"
      ].join("\n");
    }

    if (!this.isAllowed(message)) {
      return "未授权。先发送 /whoami 获取 userId，再把它加入 TELEGRAM_ALLOWED_USER_IDS。";
    }

    if (!this.config.tasks.plainTextAsTask) {
      return [
        "Pigsty 已收到消息，但当前 PLAIN_TEXT_AS_TASK=false，所以聊天内容不会被当作任务执行。",
        "如果这是你的私人 bot，把 .env 里的 PLAIN_TEXT_AS_TASK=true 和 AUTO_RUN=true 打开后重启 Pigsty。"
      ].join("\n");
    }

    return this.createConversationalTask(message, text);
  }
}
