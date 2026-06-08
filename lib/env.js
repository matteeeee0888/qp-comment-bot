// lib/env.js
import { readFile } from "node:fs/promises";

export async function loadToken(tokenEnvPath) {
  // Cloud (GitHub Actions / CI): token comes from the environment, not a local file.
  if (process.env.META_ACCESS_TOKEN) return process.env.META_ACCESS_TOKEN.trim();
  const text = await readFile(tokenEnvPath, "utf8");
  const line = text.split("\n").find((l) => l.startsWith("META_ACCESS_TOKEN="));
  if (!line) throw new Error(`META_ACCESS_TOKEN not found in ${tokenEnvPath}`);
  return line.slice("META_ACCESS_TOKEN=".length).trim();
}

export async function loadConfig(url = new URL("../config.json", import.meta.url)) {
  return JSON.parse(await readFile(url, "utf8"));
}

export async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}
