import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { addClient, broadcast } from "./ws.js";
import { startWatcher, stopWatcher } from "./watcher.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import projectRoutes from "./routes/projects.js";
import agentRoutes from "./routes/agents.js";
import teamRoutes from "./routes/teams.js";
import skillRoutes from "./routes/skills.js";
import healthRoutes from "./routes/health.js";
import starterRoutes from "./routes/starters.js";
import manifestRoutes from "./routes/manifest.js";
import diffRoutes from "./routes/diff.js";
import flowRoutes from "./routes/flow.js";
import longwriteRoutes from "./routes/longwrite.js";
import { RuntimeStatusProvider } from "./services/runtime-status.js";
import { createUsageRoutes } from "./routes/usage.js";
import { MemoryWriter } from "./services/memory-writer.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { createAuthHook } from "./middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type HttpError = Error & {
  statusCode?: number;
  code?: string;
  validation?: unknown;
};

function asHttpError(error: unknown): HttpError {
  return error instanceof Error ? (error as HttpError) : (new Error(String(error)) as HttpError);
}

export async function createServer(opts: { host?: string; port?: number; authToken?: string } = {}) {
  const host = opts.host ?? "0.0.0.0";
  const port = opts.port ?? 3456;
  const isDev = process.env.NODE_ENV !== "production";

  const statusProvider = new RuntimeStatusProvider();
  // Start OpenClaw observer by default (existing behavior)
  statusProvider.addRuntime("openclaw", (event) => {
    broadcast({ type: "runtime:" + event.type, ...(typeof event.data === "object" ? event.data as Record<string, unknown> : {}) });
  }).catch(() => { /* OpenClaw gateway not available */ });
  // Start ClawTeam observer (reads ~/.clawteam/ state)
  statusProvider.addRuntime("clawteam", (event) => {
    broadcast({ type: "runtime:" + event.type, ...(typeof event.data === "object" ? event.data as Record<string, unknown> : {}) });
  }).catch(() => { /* ClawTeam not installed */ });

  const app = Fastify({ logger: false });

  // Auth middleware (if token configured)
  const authHook = createAuthHook(opts.authToken);
  if (authHook) {
    app.addHook("onRequest", authHook);
  }

  // CORS in dev mode only
  if (isDev) {
    await app.register(fastifyCors, { origin: true });
  }

  // WebSocket
  await app.register(fastifyWebsocket);
  app.get("/ws", { websocket: true }, (socket) => {
    addClient(socket);
  });

  // Error handler — returns JSON matching spec error response format
  app.setErrorHandler((error, _request, reply) => {
    const err = asHttpError(error);
    const status = err.statusCode ?? 500;
    reply.status(status).send({
      error: err.message,
      code: err.code ?? "INTERNAL_ERROR",
      details: err.validation ?? {},
    });
  });

  // Static files in production
  if (!isDev) {
    await app.register(fastifyStatic, {
      root: path.join(__dirname, "../dist/client"),
      wildcard: false,
    });
    // SPA fallback (only for non-API routes)
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.status(404).send({ error: "Not found", code: "NOT_FOUND", details: {} });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  // Health endpoint
  app.get("/api/ping", async () => ({ status: "ok" }));

  // API routes
  await app.register(projectRoutes);
  await app.register(agentRoutes);
  await app.register(teamRoutes);
  await app.register(skillRoutes);
  await app.register(healthRoutes);
  await app.register(starterRoutes);
  await app.register(manifestRoutes);
  await app.register(diffRoutes);
  await app.register(flowRoutes);
  await app.register(longwriteRoutes);
  await app.register(createUsageRoutes(statusProvider));

  const memoryWriter = new MemoryWriter();
  await app.register(createMemoryRoutes(memoryWriter));

  // Graceful shutdown
  const shutdown = async () => {
    await statusProvider.stop();
    await stopWatcher();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ host, port });
  console.log(`Dashboard running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);

  await startWatcher();

  return app;
}

// Direct execution
const __filename_check = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename_check) {
  createServer();
}
