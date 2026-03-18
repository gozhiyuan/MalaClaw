import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";
import { broadcast } from "../ws.js";

let installRunning = false;
let installStartedAt = 0;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/manifest", async () => {
    return store.getManifest();
  });

  app.put("/api/manifest", async (req) => {
    const body = req.body;
    return store.updateManifest(body);
  });

  app.post("/api/install", async (req, reply) => {
    // Auto-release stale mutex after timeout
    if (installRunning && Date.now() - installStartedAt > INSTALL_TIMEOUT_MS) {
      installRunning = false;
    }
    if (installRunning) {
      return reply.status(409).send({
        error: "Install already running",
        code: "INSTALL_CONFLICT",
        details: {},
      });
    }
    installRunning = true;
    installStartedAt = Date.now();
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
