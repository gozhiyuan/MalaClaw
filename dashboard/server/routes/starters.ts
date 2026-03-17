import type { FastifyPluginAsync } from "fastify";
import path from "node:path";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/starters", async () => {
    return store.getStarters();
  });

  app.get("/api/starters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await store.getStarter(id);
    } catch {
      return reply.status(404).send({ error: `Starter "${id}" not found`, code: "NOT_FOUND", details: {} });
    }
  });

  app.post("/api/starters/:id/init", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { targetDir?: string; projectName?: string } | null;

    if (!body?.targetDir || typeof body.targetDir !== "string") {
      return reply.status(400).send({ error: "targetDir is required", code: "VALIDATION_ERROR", details: {} });
    }

    // Reject absolute paths and path traversal
    const resolved = path.resolve(body.targetDir);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd) && path.isAbsolute(body.targetDir)) {
      return reply.status(400).send({ error: "targetDir must be a relative path within the project", code: "VALIDATION_ERROR", details: {} });
    }

    return store.initStarter(id, body.targetDir, { projectName: body.projectName });
  });
};

export default routes;
