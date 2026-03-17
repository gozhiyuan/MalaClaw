import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/agents", async () => {
    return store.getAgents();
  });

  app.get("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await store.getAgent(id);
    } catch {
      return reply.status(404).send({ error: `Agent "${id}" not found`, code: "NOT_FOUND", details: {} });
    }
  });
};

export default routes;
