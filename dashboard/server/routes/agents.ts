import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/agents", async () => {
    return store.getAgents();
  });

  app.get("/api/agents/:id", async (req) => {
    const { id } = req.params as { id: string };
    return store.getAgent(id);
  });
};

export default routes;
