import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { getSetting, setSetting } from "./db.js";

const KEY_PUBLIC_URL = "public_base_url";
const KEY_HOST_PATH = "homedvr_host_path";
const KEY_TUNNEL_SERVICE = "tunnel_service_url";

export interface AppSettings {
  publicBaseUrl: string;
  hostPath: string;
  /** Value to paste into Cloudflare Tunnel Public Hostname → Service */
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

  const tunnel = getSetting(KEY_TUNNEL_SERVICE);
  if (tunnel !== null && tunnel.trim()) {
    config.tunnelServiceUrl = tunnel.trim();
  } else if (process.env.TUNNEL_SERVICE_URL) {
    config.tunnelServiceUrl = process.env.TUNNEL_SERVICE_URL;
  }
}

function envFilePath(): string {
  return path.join(config.repoPath, ".env");
}

export function isEnvWritable(): boolean {
  try {
    const p = envFilePath();
    if (!fs.existsSync(p)) {
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

  let body = out.join("\n");
  if (!body.endsWith("\n")) body += "\n";
  fs.writeFileSync(p, body, "utf8");
}

export function getAppSettings(): AppSettings {
  return {
    publicBaseUrl: config.publicBaseUrl,
    hostPath: config.hostPath || process.env.HOMEDVR_HOST_PATH || "",
    tunnelServiceUrl: config.tunnelServiceUrl,
    enableWebUpdate: config.enableWebUpdate,
    envFileWritable: isEnvWritable(),
  };
}

export function updateAppSettings(input: {
  publicBaseUrl?: string;
  hostPath?: string;
  tunnelServiceUrl?: string;
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
    process.env.HOMEDVR_HOST_PATH = v;
  }

  if (input.tunnelServiceUrl !== undefined) {
    let v = input.tunnelServiceUrl.trim().replace(/\/$/, "");
    if (!v) v = "http://homedvr:8080";
    // allow host:port without scheme → assume http
    if (!/^https?:\/\//i.test(v)) {
      v = `http://${v}`;
    }
    config.tunnelServiceUrl = v;
    setSetting(KEY_TUNNEL_SERVICE, v);
    envUpdates.TUNNEL_SERVICE_URL = v;
  }

  if (Object.keys(envUpdates).length && isEnvWritable()) {
    writeEnvKeys(envUpdates);
  }

  return getAppSettings();
}
