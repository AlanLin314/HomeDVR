import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { getSetting, setSetting } from "./db.js";

const KEY_PUBLIC_URL = "public_base_url";
const KEY_HOST_PATH = "homedvr_host_path";

export interface AppSettings {
  publicBaseUrl: string;
  hostPath: string;
  /** Cloudflare Tunnel service target (fixed for this stack) */
  tunnelServiceUrl: string;
  enableWebUpdate: boolean;
  envFileWritable: boolean;
}

/** Load DB overrides after initDb() */
export function loadSettingsFromDb(): void {
  const pub = getSetting(KEY_PUBLIC_URL);
  if (pub !== null) config.publicBaseUrl = pub;

  const host = getSetting(KEY_HOST_PATH);
  if (host !== null && host.trim()) config.hostPath = host.trim();
  else if (!config.hostPath && process.env.HOMEDVR_HOST_PATH) {
    config.hostPath = process.env.HOMEDVR_HOST_PATH.replace(/\/$/, "");
  }
}

function envFilePath(): string {
  return path.join(config.repoPath, ".env");
}

export function isEnvWritable(): boolean {
  try {
    const p = envFilePath();
    if (!fs.existsSync(p)) {
      // can create if repo dir writable
      fs.accessSync(config.repoPath, fs.constants.W_OK);
      return true;
    }
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Upsert KEY=value in .env (create file if missing). Only touch listed keys. */
export function writeEnvKeys(updates: Record<string, string>): void {
  const p = envFilePath();
  let text = "";
  if (fs.existsSync(p)) {
    text = fs.readFileSync(p, "utf8");
  }

  const lines = text.split(/\r?\n/);
  const keys = new Set(Object.keys(updates));
  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && keys.has(m[1])) {
      const k = m[1];
      out.push(`${k}=${updates[k]}`);
      seen.add(k);
    } else {
      out.push(line);
    }
  }

  for (const k of keys) {
    if (!seen.has(k)) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`${k}=${updates[k]}`);
    }
  }

  // Ensure trailing newline
  let body = out.join("\n");
  if (!body.endsWith("\n")) body += "\n";
  fs.writeFileSync(p, body, "utf8");
}

export function getAppSettings(): AppSettings {
  return {
    publicBaseUrl: config.publicBaseUrl,
    hostPath: config.hostPath || process.env.HOMEDVR_HOST_PATH || "",
    tunnelServiceUrl: "http://homedvr:8080",
    enableWebUpdate: config.enableWebUpdate,
    envFileWritable: isEnvWritable(),
  };
}

export function updateAppSettings(input: {
  publicBaseUrl?: string;
  hostPath?: string;
}): AppSettings {
  const envUpdates: Record<string, string> = {};

  if (input.publicBaseUrl !== undefined) {
    const v = input.publicBaseUrl.trim().replace(/\/$/, "");
    if (v && !/^https?:\/\//i.test(v)) {
      throw new Error("外網網址需以 http:// 或 https:// 開頭");
    }
    config.publicBaseUrl = v;
    setSetting(KEY_PUBLIC_URL, v);
    envUpdates.PUBLIC_BASE_URL = v;
  }

  if (input.hostPath !== undefined) {
    const v = input.hostPath.trim().replace(/\/$/, "");
    if (v && !v.startsWith("/")) {
      throw new Error("主機路徑需為絕對路徑，例如 /root/HomeDVR");
    }
    config.hostPath = v;
    setSetting(KEY_HOST_PATH, v);
    envUpdates.HOMEDVR_HOST_PATH = v;
    // update script also reads env
    process.env.HOMEDVR_HOST_PATH = v;
  }

  if (Object.keys(envUpdates).length && isEnvWritable()) {
    writeEnvKeys(envUpdates);
  }

  return getAppSettings();
}
