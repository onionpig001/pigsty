import { CodexProvider } from "./codexProvider.js";
import { MockProvider } from "./mockProvider.js";

export function createProvider(config) {
  if (config.provider.name === "codex") {
    return new CodexProvider(config);
  }
  return new MockProvider(config);
}
