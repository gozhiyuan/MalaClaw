import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/skills", async () => {
    return store.getSkills();
  });

  app.get("/api/skills/check", async () => {
    return store.checkSkills();
  });

  app.post("/api/skills/sync", async () => {
    return store.syncSkills();
  });
};

export default routes;
