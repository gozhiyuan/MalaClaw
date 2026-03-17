import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";
import { broadcast } from "../ws.js";

let installRunning = false;

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/manifest", async () => {
    return store.getManifest();
  });

  app.put("/api/manifest", async (req) => {
    const body = req.body;
    return store.updateManifest(body);
  });

  app.post("/api/install", async (req, reply) => {
    if (installRunning) {
      return reply.status(409).send({
        error: "Install already running",
        code: "INSTALL_CONFLICT",
        details: {},
      });
    }
    installRunning = true;
    try {
      const result = await store.install({
        projectDir: (req.body as any)?.projectDir,
        onProgress: (p) => broadcast({ type: "install:progress", ...p }),
      });
      return result;
    } finally {
      installRunning = false;
    }
  });
};

export default routes;
