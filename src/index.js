import { mkdirSync } from "node:fs";
import { paths, runtimeConfig } from "./config.js";
import { TaskStore } from "./core/taskStore.js";
import { TaskRunner } from "./core/taskRunner.js";
import { Notifier } from "./core/notifier.js";
import { MessageRouter } from "./core/router.js";
import { createProvider } from "./providers/index.js";
import { TelegramChannel } from "./channels/telegram.js";
import { HttpChannel } from "./channels/http.js";
import { TerminalManager } from "./web/terminalManager.js";
import { WebConsole } from "./web/webConsole.js";

const config = runtimeConfig();
mkdirSync(paths.outputs, { recursive: true });
mkdirSync(paths.workspace, { recursive: true });

const store = new TaskStore();
const provider = createProvider(config);
const notifier = new Notifier();
const runner = new TaskRunner({ store, provider, notifier, config });
const router = new MessageRouter({ store, runner, config });
const terminalManager = new TerminalManager(config);
const webConsole = new WebConsole({ config, terminalManager });

const httpChannel = new HttpChannel({ config, router, store, webConsole });
const telegramChannel = new TelegramChannel({ config, router });

notifier.register("telegram", telegramChannel);

runner.start();
httpChannel.start();
telegramChannel.start();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("Shutting down Pigsty");
  telegramChannel.stop();
  httpChannel.stop();
  terminalManager.stopAll();
  runner.stop();
  process.exit(0);
}
