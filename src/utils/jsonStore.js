import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function ensureJson(path, fallback) {
  if (!existsSync(path)) {
    writeJson(path, fallback);
  }
}
