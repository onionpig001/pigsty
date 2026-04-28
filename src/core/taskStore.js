import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { paths } from "../config.js";
import { ensureJson, readJson, writeJson } from "../utils/jsonStore.js";

export class TaskStore {
  constructor(tasksPath = paths.tasks) {
    this.tasksPath = tasksPath;
    mkdirSync(paths.dataDir, { recursive: true });
    ensureJson(this.tasksPath, []);
  }

  list() {
    return readJson(this.tasksPath, []);
  }

  save(tasks) {
    writeJson(this.tasksPath, tasks);
  }

  get(idOrPrefix) {
    const tasks = this.list();
    return tasks.find((task) => task.id === idOrPrefix) ||
      tasks.find((task) => task.id.startsWith(idOrPrefix));
  }

  create(input) {
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(),
      status: "pending_approval",
      prompt: input.prompt,
      channel: input.channel,
      chatId: input.chatId,
      userId: String(input.userId),
      delivery: input.delivery || { style: "task" },
      createdAt: now,
      updatedAt: now,
      events: [{ at: now, type: "created", message: "Task created" }]
    };
    const tasks = this.list();
    tasks.push(task);
    this.save(tasks);
    return task;
  }

  update(id, patch) {
    const tasks = this.list();
    const index = tasks.findIndex((task) => task.id === id || task.id.startsWith(id));
    if (index === -1) throw new Error(`Task not found: ${id}`);

    const next = {
      ...tasks[index],
      ...patch,
      updatedAt: new Date().toISOString()
    };
    tasks[index] = next;
    this.save(tasks);
    return next;
  }

  event(id, type, message, data) {
    const task = this.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const event = {
      at: new Date().toISOString(),
      type,
      message,
      ...(data ? { data } : {})
    };
    return this.update(task.id, {
      events: [...(task.events || []), event]
    });
  }

  recent(limit = 8) {
    return this.list()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
}
