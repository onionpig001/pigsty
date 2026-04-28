#!/usr/bin/env node
import { runtimeConfig } from "./config.js";
import { TaskStore } from "./core/taskStore.js";
import { TaskRunner } from "./core/taskRunner.js";
import { Notifier } from "./core/notifier.js";
import { createProvider } from "./providers/index.js";

const config = runtimeConfig();
const store = new TaskStore();
const provider = createProvider(config);
const notifier = new Notifier();
const runner = new TaskRunner({ store, provider, notifier, config });

function printTask(task) {
  console.log(`${task.id.slice(0, 8)} ${task.status.padEnd(16)} ${task.prompt.slice(0, 100)}`);
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (command === "demo") {
    const task = store.create({
      prompt: "写一段 150 字的远程 AI 助手产品介绍，强调 Telegram 入口和本地安全执行。",
      channel: "cli",
      chatId: "cli",
      userId: "cli"
    });
    runner.enqueue(task.id);
    await waitForDone(task.id);
    printTask(store.get(task.id));
    console.log(store.get(task.id).resultPreview);
    return;
  }

  if (command === "task") {
    const prompt = args.join(" ").trim();
    if (!prompt) throw new Error("Usage: npm run task -- <prompt>");
    const task = store.create({ prompt, channel: "cli", chatId: "cli", userId: "cli" });
    printTask(task);
    return;
  }

  if (command === "run") {
    const id = args[0];
    if (!id) throw new Error("Usage: npm run run -- <task-id>");
    runner.enqueue(id);
    await waitForDone(id);
    printTask(store.get(id));
    return;
  }

  if (command === "list") {
    store.recent(20).forEach(printTask);
    return;
  }

  console.log("Usage: node src/cli.js demo|task|run|list");
}

async function waitForDone(id) {
  runner.start();
  while (true) {
    const task = store.get(id);
    if (["completed", "failed", "cancelled"].includes(task.status)) {
      runner.stop();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
