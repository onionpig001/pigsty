import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../config.js";

export class MockProvider {
  constructor(config) {
    this.config = config;
  }

  async run(task) {
    const outputDir = resolve(paths.outputs, task.id);
    mkdirSync(outputDir, { recursive: true });
    const result = [
      `Mock result for task ${task.id.slice(0, 8)}`,
      "",
      "Received prompt:",
      task.prompt,
      "",
      "Switch AGENT_PROVIDER=codex to execute through Codex CLI."
    ].join("\n");
    writeFileSync(resolve(outputDir, "result.txt"), `${result}\n`, "utf8");
    return {
      ok: true,
      result,
      outputDir,
      files: ["result.txt"]
    };
  }
}
