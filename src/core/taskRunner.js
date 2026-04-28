export class TaskRunner {
  constructor({ store, provider, notifier, config }) {
    this.store = store;
    this.provider = provider;
    this.notifier = notifier;
    this.config = config;
    this.active = 0;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.drain(), 1000);
    this.drain();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  enqueue(id) {
    const task = this.store.update(id, { status: "queued", queuedAt: new Date().toISOString() });
    this.store.event(task.id, "queued", "Task queued");
    this.drain();
    return task;
  }

  cancel(id) {
    const task = this.store.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    if (task.status === "running" && this.provider.cancel) {
      this.provider.cancel(task.id);
    }
    const next = this.store.update(task.id, { status: "cancelled", cancelledAt: new Date().toISOString() });
    this.store.event(task.id, "cancelled", "Task cancelled");
    return next;
  }

  drain() {
    if (this.active >= this.config.tasks.maxActive) return;
    const next = this.store.list()
      .filter((task) => task.status === "queued")
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    if (!next) return;
    this.runTask(next);
  }

  async runTask(task) {
    this.active += 1;
    const conversational = task.delivery?.style === "conversation";
    const stopTyping = conversational ? this.notifier.startTyping(task) : () => {};
    this.store.update(task.id, { status: "running", startedAt: new Date().toISOString() });
    this.store.event(task.id, "running", "Task started");
    if (!conversational) {
      await this.notifier.notify(task, `开始执行任务 ${task.id.slice(0, 8)}`);
    }

    try {
      const result = await this.provider.run(task);
      const status = result.ok ? "completed" : "failed";
      this.store.update(task.id, {
        status,
        finishedAt: new Date().toISOString(),
        outputDir: result.outputDir,
        files: result.files,
        resultPreview: result.result.slice(0, this.config.tasks.resultPreviewLength)
      });
      this.store.event(task.id, status, result.result, { outputDir: result.outputDir, files: result.files });
      await this.notifier.notify(
        task,
        conversational ? this.formatConversationResult(status, result) : this.formatResult(task.id, status, result)
      );
    } catch (error) {
      this.store.update(task.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        resultPreview: error.stack || error.message
      });
      this.store.event(task.id, "failed", error.message);
      await this.notifier.notify(
        task,
        conversational ? `我这边执行失败了：${error.message}` : `任务 ${task.id.slice(0, 8)} 失败：${error.message}`
      );
    } finally {
      stopTyping();
      this.active -= 1;
      this.drain();
    }
  }

  formatResult(id, status, result) {
    return [
      `任务 ${id.slice(0, 8)} ${status}`,
      "",
      result.result.slice(0, this.config.tasks.resultPreviewLength),
      "",
      `产物目录：${result.outputDir}`
    ].join("\n");
  }

  formatConversationResult(status, result) {
    if (status !== "completed") {
      return `我这边执行失败了：${result.result.slice(0, this.config.tasks.resultPreviewLength)}`;
    }
    const text = result.result.trim();
    return text ? text.slice(0, this.config.tasks.resultPreviewLength) : "完成了。";
  }
}
