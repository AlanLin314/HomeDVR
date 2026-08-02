import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import httpProxy from "@fastify/http-proxy";
import fs from "node:fs";
import { config } from "./config.js";
import { initDb, listCameras, updateCameraRow } from "./db.js";
import { reconcileStreams } from "./go2rtc.js";
import { loadSettingsFromDb } from "./settings.js";
import { cameraRoutes } from "./routes/cameras.js";
import { groupRoutes } from "./routes/groups.js";
import { systemRoutes } from "./routes/system.js";

async function main() {
  initDb();
  loadSettingsFromDb();

  const app = Fastify({
    logger: true,
  });

  await app.register(cors, { origin: true });

  // Same-origin media proxy → local go2rtc (single-container layout)
  await app.register(httpProxy, {
    upstream: config.go2rtcUrl,
    prefix: "/go2rtc",
    rewritePrefix: "",
    websocket: true,
  });

  await app.register(groupRoutes);
  await app.register(cameraRoutes);
  await app.register(systemRoutes);

  // SPA static files (production Docker image)
  if (fs.existsSync(config.publicDir)) {
    await app.register(fastifyStatic, {
      root: config.publicDir,
      prefix: "/",
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/go2rtc")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  // Background reconcile with go2rtc (retry a few times on boot)
  void (async () => {
    for (let i = 0; i < 10; i++) {
      try {
        const cameras = listCameras();
        const result = await reconcileStreams(cameras);
        for (const f of result.failed) {
          updateCameraRow(f.id, {
            sync_error: f.error,
            updated_at: new Date().toISOString(),
          });
        }
        for (const id of result.ok) {
          updateCameraRow(id, {
            sync_error: null,
            updated_at: new Date().toISOString(),
          });
        }
        app.log.info(
          { ok: result.ok.length, failed: result.failed.length },
          "go2rtc reconcile complete",
        );
        break;
      } catch (e) {
        app.log.warn(
          { err: e, attempt: i + 1 },
          "go2rtc reconcile failed, retrying...",
        );
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    `HomeDVR API listening on :${config.port} (webUpdate=${config.enableWebUpdate})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
