import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createGroup,
  listGroupsPublic,
  removeGroup,
  updateGroup,
} from "../groups.js";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  id: z.string().min(1).max(64).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  sortOrder: z.number().int().optional(),
});

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/groups", async () => {
    return { groups: listGroupsPublic() };
  });

  app.post("/api/groups", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const group = createGroup(parsed.data);
      return reply.code(201).send({ group });
    } catch (e) {
      return reply
        .code(400)
        .send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put<{ Params: { id: string } }>("/api/groups/:id", async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const group = updateGroup(req.params.id, parsed.data);
      if (!group) return reply.code(404).send({ error: "Group not found" });
      return { group };
    } catch (e) {
      return reply
        .code(400)
        .send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/groups/:id",
    async (req, reply) => {
      const ok = removeGroup(req.params.id);
      if (!ok) return reply.code(404).send({ error: "Group not found" });
      return { ok: true };
    },
  );
}
