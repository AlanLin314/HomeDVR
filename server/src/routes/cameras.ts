import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createCamera,
  getCameraDetail,
  listCamerasPublic,
  removeCamera,
  testCameraSource,
  updateCamera,
} from "../cameras.js";

const groupIdField = z
  .union([z.string().min(1).max(64), z.null()])
  .optional();

const createSchema = z.object({
  name: z.string().min(1).max(120),
  source: z.string().min(1).max(2000),
  /** Optional NVR/substream URL for multi-view wall */
  wallSource: z.union([z.string().max(2000), z.null()]).optional(),
  enabled: z.boolean().optional(),
  id: z.string().min(1).max(64).optional(),
  groupId: groupIdField,
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  source: z.string().min(1).max(2000).optional(),
  wallSource: z.union([z.string().max(2000), z.null()]).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  groupId: groupIdField,
});

const testSchema = z.object({
  source: z.string().min(1).max(2000),
});

export async function cameraRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/cameras", async (req) => {
    const q = req.query as {
      enabled?: string;
      groupId?: string;
      ungrouped?: string;
    };
    const enabledOnly = q.enabled === "1" || q.enabled === "true";
    const ungrouped = q.ungrouped === "1" || q.ungrouped === "true";
    return {
      cameras: listCamerasPublic({
        enabledOnly,
        groupId: ungrouped ? undefined : q.groupId,
        ungrouped,
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/api/cameras/:id", async (req, reply) => {
    const cam = getCameraDetail(req.params.id);
    if (!cam) return reply.code(404).send({ error: "Camera not found" });
    return { camera: cam };
  });

  app.post("/api/cameras", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const camera = await createCamera(parsed.data);
      return reply.code(201).send({ camera });
    } catch (e) {
      return reply
        .code(400)
        .send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put<{ Params: { id: string } }>("/api/cameras/:id", async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const camera = await updateCamera(req.params.id, parsed.data);
      if (!camera) return reply.code(404).send({ error: "Camera not found" });
      return { camera };
    } catch (e) {
      return reply
        .code(400)
        .send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/cameras/:id",
    async (req, reply) => {
      const ok = await removeCamera(req.params.id);
      if (!ok) return reply.code(404).send({ error: "Camera not found" });
      return { ok: true };
    },
  );

  app.post("/api/cameras/test", async (req, reply) => {
    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const result = await testCameraSource(parsed.data.source);
    return result;
  });

  app.post<{ Params: { id: string } }>(
    "/api/cameras/:id/test",
    async (req, reply) => {
      const cam = getCameraDetail(req.params.id);
      if (!cam) return reply.code(404).send({ error: "Camera not found" });
      const result = await testCameraSource(cam.source);
      return result;
    },
  );
}
