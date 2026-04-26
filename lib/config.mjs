import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_CONFIG = {
  output_dir: "outputs",
  retry_count: 1,
  retry_delay_ms: 500,
  json: true
};

export function configPath() {
  return join(homedir(), ".jimeng-cli", "config.json");
}

function normalizeValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return value;
}

function normalizeKey(key) {
  return String(key).replaceAll("-", "_");
}

export async function loadConfig() {
  let raw;
  try {
    raw = await readFile(configPath(), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { ...DEFAULT_CONFIG };
  }
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (error) {
    throw new Error(`Invalid config JSON at ${configPath()}: ${error.message}`);
  }
}

export async function saveConfig(config) {
  const file = configPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export async function getConfigValue(key) {
  const config = await loadConfig();
  if (!key) return { ok: true, path: configPath(), config };
  key = normalizeKey(key);
  return { ok: true, path: configPath(), key, value: config[key] };
}

export async function setConfigValue(key, value) {
  if (!key || key === true) throw new Error("config key is required");
  if (value === undefined || value === true) throw new Error("config value is required");
  key = normalizeKey(key);
  const config = await loadConfig();
  config[key] = normalizeValue(value);
  await saveConfig(config);
  return { ok: true, path: configPath(), key, value: config[key], config };
}
