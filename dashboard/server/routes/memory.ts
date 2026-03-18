import type { FastifyPluginAsync } from "fastify";
import type { MemoryWriter } from "../services/memory-writer.js";

export function createMemoryRoutes(writer: MemoryWriter): FastifyPluginAsync {
  return async (app) => {
    app.put<{ Params: { id: string; teamId: string }; Body: { content: string } }>(
      "/api/projects/:id/kanban/:teamId",
      async (request, reply) => {
        const { id, teamId } = request.params;
        const body = request.body as { content?: string };
        if (!body?.content || typeof body.content !== "string") {
          return reply.status(400).send({
            error: "Missing or invalid 'content' field",
            code: "VALIDATION_ERROR",
            details: {},
          });
        }
        try {
          await writer.writeKanban({
            projectId: id,
            teamId,
            content: body.content,
            requestingAgent: "dashboard",
          });
          return { ok: true };
        } catch (err) {
          return reply.status(403).send({
            error: (err as Error).message,
            code: "OWNERSHIP_ERROR",
            details: {},
          });
        }
      }
    );
  };
}
