import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/projects", async () => {
    const state = await store.getProjects();
    return state.projects;
  });

  app.get("/api/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await store.getProject(id);
    if (!project) {
      return reply.status(404).send({
        error: "Project not found",
        code: "NOT_FOUND",
        details: {},
      });
    }
    return project;
  });

  app.get("/api/projects/:id/kanban/:teamId", async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    return store.getKanban(id, teamId);
  });

  app.get("/api/projects/:id/log/:teamId", async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    return store.getTaskLog(id, teamId);
  });
};

export default routes;
