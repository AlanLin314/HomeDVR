import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
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
    return {
      ok: true,
      go2rtc,
      version: config.appVersion,
      gitSha: config.gitSha,
    };
  });

  app.get("/api/system/version", async () => {
    return {
      version: config.appVersion,
      gitSha: config.gitSha,
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
      return {
        local: info.local,
        remote: info.remote,
        upstream: info.upstream,
        behind,
        ahead: Number(info.ahead ?? 0),
        dirty: info.dirty === "1",
        remoteMessage: info.remote_message ?? "",
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
