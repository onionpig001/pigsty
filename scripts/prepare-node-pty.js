import { chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helpers = [
  "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper",
  "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
  "node_modules/node-pty/build/Release/spawn-helper"
];

for (const helper of helpers) {
  const path = resolve(rootDir, helper);
  if (existsSync(path)) {
    chmodSync(path, 0o755);
    console.log(`Prepared ${helper}`);
  }
}
