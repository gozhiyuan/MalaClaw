import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/starters", async () => {
    return store.getStarters();
  });

  app.get("/api/starters/:id", async (req) => {
    const { id } = req.params as { id: string };
    return store.getStarter(id);
  });

  app.post("/api/starters/:id/init", async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    return store.initStarter(id, body.targetDir, { projectName: body.projectName });
  });
};

export default routes;
