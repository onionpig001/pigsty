import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { paths } from "../config.js";

function buildPrompt(task, systemPrompt) {
  const prompt = task.prompt.trim();
  if (prompt.startsWith("/")) {
    return prompt;
  }

  return [
    systemPrompt,
    "",
    "Remote task:",
    prompt,
    "",
    "When complete, include a concise summary, files changed or created, and verification performed."
  ].join("\n");
}

export class CodexProvider {
  constructor(config) {
    this.config = config;
    this.running = new Map();
  }

  cancel(taskId) {
    const child = this.running.get(taskId);
    if (!child) return false;
    child.kill("SIGTERM");
    return true;
  }

  run(task) {
    const outputDir = resolve(paths.outputs, task.id);
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(this.config.provider.workspaceDir, { recursive: true });

    const resultPath = resolve(outputDir, "result.txt");
    const stdoutPath = resolve(outputDir, "stdout.log");
    const stderrPath = resolve(outputDir, "stderr.log");
    const promptPath = resolve(outputDir, "prompt.txt");
    const prompt = buildPrompt(task, this.config.policies.systemPrompt || "");
    writeFileSync(promptPath, `${prompt}\n`, "utf8");

    const args = [
      "exec",
      "--cd",
      this.config.provider.workspaceDir,
      "--sandbox",
      this.config.provider.codexSandbox,
      "--skip-git-repo-check",
      "--output-last-message",
      resultPath
    ];

    if (this.config.provider.codexFullAuto) args.push("--full-auto");
    if (this.config.provider.codexModel) args.push("--model", this.config.provider.codexModel);
    if (this.config.provider.codexProfile) args.push("--profile", this.config.provider.codexProfile);
    args.push("-");

    return new Promise((resolvePromise) => {
      const child = spawn(this.config.provider.codexBin, args, {
        cwd: this.config.provider.workspaceDir,
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.running.set(task.id, child);

      const stdout = [];
      const stderr = [];
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
      }, this.config.tasks.timeoutMs);

      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      child.on("error", (error) => {
        clearTimeout(timeout);
        this.running.delete(task.id);
        writeFileSync(stderrPath, `${error.stack || error.message}\n`, "utf8");
        resolvePromise({
          ok: false,
          result: error.message,
          outputDir,
          files: ["prompt.txt", "stderr.log"]
        });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        this.running.delete(task.id);
        const stdoutText = Buffer.concat(stdout).toString("utf8");
        const stderrText = Buffer.concat(stderr).toString("utf8");
        writeFileSync(stdoutPath, stdoutText, "utf8");
        writeFileSync(stderrPath, stderrText, "utf8");

        const ok = code === 0 && !signal;
        const finalMessage = existsSync(resultPath) ? readFileSync(resultPath, "utf8").trim() : "";
        const result = ok
          ? (finalMessage || `Codex task completed. Result saved to ${resultPath}`)
          : `Codex task failed with code=${code ?? "null"} signal=${signal ?? "none"}\n${stderrText}`;
        resolvePromise({
          ok,
          result,
          outputDir,
          files: ["prompt.txt", "result.txt", "stdout.log", "stderr.log"]
        });
      });
      child.stdin.end(prompt);
    });
  }
}
