import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/teams", async () => {
    return store.getTeams();
  });

  app.get("/api/teams/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await store.getTeam(id);
    } catch {
      return reply.status(404).send({ error: `Team "${id}" not found`, code: "NOT_FOUND", details: {} });
    }
  });
};

export default routes;
