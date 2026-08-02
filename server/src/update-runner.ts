import { spawn } from "node:child_process";
import fs from "node:fs";
import { config } from "./config.js";

export type UpdateStatus =
  | "idle"
  | "running"
  | "success"
  | "failed";

export interface UpdateJobState {
  status: UpdateStatus;
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  exitCode: number | null;
  error: string | null;
}

const MAX_LOG_LINES = 500;

const state: UpdateJobState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  log: [],
  exitCode: null,
  error: null,
};

function appendLog(line: string): void {
  state.log.push(line);
  if (state.log.length > MAX_LOG_LINES) {
    state.log = state.log.slice(-MAX_LOG_LINES);
  }
}

export function getUpdateState(): UpdateJobState {
  return {
    ...state,
    log: [...state.log],
  };
}

function runScript(
  scriptPath: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`script not found: ${scriptPath}`));
      return;
    }

    const child = spawn("bash", [scriptPath], {
      cwd: config.repoPath,
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
      windowsHide: true,
    });

    let output = "";

    child.stdout.on("data", (buf: Buffer) => {
      const text = buf.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.length) appendLog(line);
      }
    });

    child.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.length) appendLog(line);
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

/** Parse KEY=value lines from check-update.sh */
export function parseKvOutput(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

export async function checkForUpdates(): Promise<Record<string, string>> {
  if (!config.enableWebUpdate) {
    throw new Error("Web update is disabled (ENABLE_WEB_UPDATE=false)");
  }
  const { code, output } = await runScript(config.checkUpdateScript);
  const kv = parseKvOutput(output);
  if (code !== 0 && !kv.local) {
    throw new Error(kv.error || output || `check failed (${code})`);
  }
  return kv;
}

export async function startUpdate(): Promise<UpdateJobState> {
  if (!config.enableWebUpdate) {
    throw new Error("Web update is disabled (ENABLE_WEB_UPDATE=false)");
  }
  if (state.status === "running") {
    throw new Error("An update is already running");
  }

  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.log = [];
  state.exitCode = null;
  state.error = null;
  appendLog("[homedvr] update job started");

  // Fire and forget — status polled via GET
  void (async () => {
    try {
      const { code } = await runScript(config.updateScript);
      state.exitCode = code;
      state.finishedAt = new Date().toISOString();
      if (code === 0) {
        state.status = "success";
        appendLog("[homedvr] update finished successfully");
      } else {
        state.status = "failed";
        state.error = `update script exited with code ${code}`;
        appendLog(`[homedvr] ${state.error}`);
      }
    } catch (e) {
      state.status = "failed";
      state.finishedAt = new Date().toISOString();
      state.error = e instanceof Error ? e.message : String(e);
      appendLog(`[homedvr] ERROR: ${state.error}`);
    }
  })();

  return getUpdateState();
}
