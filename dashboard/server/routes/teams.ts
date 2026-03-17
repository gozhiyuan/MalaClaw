import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/teams", async () => {
    return store.getTeams();
  });

  app.get("/api/teams/:id", async (req) => {
    const { id } = req.params as { id: string };
    return store.getTeam(id);
  });
};

export default routes;
