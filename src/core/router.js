function shortTask(task) {
  return `${task.id.slice(0, 8)} ${task.status} ${new Date(task.createdAt).toLocaleString()} ${task.prompt.slice(0, 80)}`;
}

function statusReply(task, config) {
  if (task.status === "completed") {
    return task.resultPreview?.trim() || "完成了，但这条任务没有返回可展示的文本。";
  }
  if (task.status === "failed") {
    return task.resultPreview
      ? `执行失败了：\n${task.resultPreview.slice(0, config.tasks.resultPreviewLength)}`
      : "执行失败了。";
  }
  if (task.status === "running") {
    return "还在处理，我完成后会直接把结果发回来。";
  }
  if (task.status === "queued") {
    return "已经在队列里了，轮到它就会开始处理。";
  }
  if (task.status === "pending_approval") {
    return `这条任务还没开始。发送 /bridge_run ${task.id.slice(0, 8)} 执行。`;
  }
  return shortTask(task);
}

function helpText(config) {
  return [
    "用法：",
    config.tasks.plainTextAsTask && config.tasks.autoRun
      ? "直接发自然语言需求，我会像正常对话一样处理并回复。"
      : "发送 /bridge_task <需求> 创建任务。",
    "Codex slash 命令会原样转发，例如 /status、/model、/help。",
    "",
    "Bridge 管理命令：",
    "/whoami - 查看你的 Telegram user id",
    "/bridge_help - 查看这份说明",
    "/bridge_task <需求> - 创建任务",
    "/bridge_run <任务ID> - 执行待批准任务",
    "/bridge_quick <需求> - 创建并立即执行，需要 AUTO_RUN=true",
    "/bridge_status [任务ID] - 查看 bridge 任务状态",
    "/bridge_tasks - 最近任务",
    "/bridge_cancel <任务ID> - 取消任务",
    "",
    `当前 provider=${config.provider.name}, autoRun=${config.tasks.autoRun}`
  ].join("\n");
}

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

  createTask(message, prompt, autoRun = false, options = {}) {
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

    if (autoRun || this.config.tasks.autoRun) {
      this.runner.enqueue(task.id);
      if (options.conversational) return "";
      return `已创建并排队：${task.id.slice(0, 8)}`;
    }
    return `已创建待批准任务：${task.id.slice(0, 8)}\n发送 /bridge_run ${task.id.slice(0, 8)} 开始执行。`;
  }

  createConversationalTask(message, text) {
    const conversational =
      message.channel === "telegram" &&
      this.config.tasks.autoRun &&
      this.config.tasks.conversationalMode;
    return this.createTask(message, text, this.config.tasks.autoRun, { conversational });
  }

  async handle(message) {
    const text = (message.text || "").trim();
    if (!text) return "";

    if (text === "/start" || text === "/bridge_help") {
      return helpText(this.config);
    }

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

    if (text === "/status") {
      return getCodexStatus(this.config);
    }

    if (text.startsWith("/bridge_task ")) {
      return this.createTask(message, text.slice(13), false);
    }

    if (text.startsWith("/bridge_quick ")) {
      if (!this.config.tasks.autoRun) {
        return "当前 AUTO_RUN=false。请用 /bridge_task 创建后再 /bridge_run。";
      }
      return this.createTask(message, text.slice(14), true);
    }

    if (text.startsWith("/bridge_run ")) {
      const id = text.slice(12).trim();
      const task = this.store.get(id);
      if (!task) return `找不到任务：${id}`;
      if (String(task.userId) !== String(message.userId)) return "不能执行其他用户创建的任务。";
      if (!["pending_approval", "failed", "cancelled"].includes(task.status)) {
        return `任务状态为 ${task.status}，不能排队执行。`;
      }
      this.runner.enqueue(task.id);
      return `已排队：${task.id.slice(0, 8)}`;
    }

    if (text.startsWith("/bridge_cancel ")) {
      const id = text.slice(15).trim();
      const task = this.store.get(id);
      if (!task) return `找不到任务：${id}`;
      if (String(task.userId) !== String(message.userId)) return "不能取消其他用户创建的任务。";
      if (["completed", "failed"].includes(task.status)) return `任务已结束：${task.status}`;
      this.runner.cancel(task.id);
      return `已取消：${task.id.slice(0, 8)}`;
    }

    if (text === "/bridge_tasks") {
      const tasks = this.store.recent(8).filter((task) => String(task.userId) === String(message.userId));
      return tasks.length ? tasks.map(shortTask).join("\n") : "暂无任务。";
    }

    if (text === "/bridge_status" || text.startsWith("/bridge_status ")) {
      const id = text.replace("/bridge_status", "").trim();
      const task = id
        ? this.store.get(id)
        : this.store.recent(20).find((item) => String(item.userId) === String(message.userId));
      if (!task) return "暂无任务。";
      if (String(task.userId) !== String(message.userId)) return "不能查看其他用户任务。";
      return statusReply(task, this.config);
    }

    if (this.config.tasks.plainTextAsTask) {
      return this.createConversationalTask(message, text);
    }

    return "我收到消息了。直接发需求即可，或发送 /bridge_help 查看命令。";
  }
}
import { getCodexStatus } from "../providers/codexStatus.js";
