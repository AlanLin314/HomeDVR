import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { getLocalGitInfo } from "../git-info.js";
import { isGo2rtcHealthy } from "../go2rtc.js";
import { getAppSettings, updateAppSettings } from "../settings.js";
import {
  checkForUpdates,
  getUpdateState,
  startUpdate,
} from "../update-runner.js";

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => {
    const go2rtc = await isGo2rtcHealthy();
    const git = getLocalGitInfo();
    return {
      ok: true,
      go2rtc,
      version: config.appVersion,
      gitSha: git.shortSha || config.gitSha,
    };
  });

  app.get("/api/system/version", async () => {
    const git = getLocalGitInfo();
    return {
      version: config.appVersion,
      gitSha: git.shortSha || config.gitSha,
      gitMessage: git.message,
      gitDate: git.date || null,
      enableWebUpdate: config.enableWebUpdate,
      publicBaseUrl: config.publicBaseUrl || null,
      update: getUpdateState(),
    };
  });

  app.get("/api/system/settings", async () => {
    return { settings: getAppSettings() };
  });

  app.put("/api/system/settings", async (req, reply) => {
    const schema = z.object({
      publicBaseUrl: z.string().max(500).optional(),
      hostPath: z.string().max(500).optional(),
      tunnelServiceUrl: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const settings = updateAppSettings(parsed.data);
      return { settings };
    } catch (e) {
      return reply
        .code(400)
        .send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/system/update/status", async () => {
    return getUpdateState();
  });

  app.get("/api/system/update/check", async (_req, reply) => {
    if (!config.enableWebUpdate) {
      return reply.code(403).send({
        error: "Web update is disabled (ENABLE_WEB_UPDATE=false)",
      });
    }
    try {
      const info = await checkForUpdates();
      const behind = Number(info.behind ?? 0);
      const remoteCommits = (info.remote_commits ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        local: info.local,
        remote: info.remote,
        upstream: info.upstream,
        behind,
        ahead: Number(info.ahead ?? 0),
        dirty: info.dirty === "1",
        localMessage: info.local_message ?? "",
        localDate: info.local_date ?? "",
        remoteMessage: info.remote_message ?? "",
        remoteDate: info.remote_date ?? "",
        remoteCommits,
        updateAvailable: behind > 0,
      };
    } catch (e) {
      return reply
        .code(500)
        .send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/system/update", async (req, reply) => {
    if (!config.enableWebUpdate) {
      return reply.code(403).send({
        error: "Web update is disabled (ENABLE_WEB_UPDATE=false)",
      });
    }
    const schema = z.object({ confirm: z.literal(true) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Body must be { "confirm": true }',
      });
    }
    try {
      const state = await startUpdate();
      return reply.code(202).send(state);
    } catch (e) {
      return reply
        .code(409)
        .send({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
