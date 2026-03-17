import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/health", async () => {
    return store.getHealth();
  });
};

export default routes;
