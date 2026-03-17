import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/diff", async () => {
    return store.getDiff();
  });
};

export default routes;
