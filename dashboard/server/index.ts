import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { addClient } from "./ws.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(opts: { host?: string; port?: number } = {}) {
  const host = opts.host ?? "0.0.0.0";
  const port = opts.port ?? 3456;
  const isDev = process.env.NODE_ENV !== "production";

  const app = Fastify({ logger: false });

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
    const status = error.statusCode ?? 500;
    reply.status(status).send({
      error: error.message,
      code: error.code ?? "INTERNAL_ERROR",
      details: error.validation ?? {},
    });
  });

  // Static files in production
  if (!isDev) {
    await app.register(fastifyStatic, {
      root: path.join(__dirname, "../client"),
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

  // Graceful shutdown
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ host, port });
  console.log(`Dashboard running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);

  return app;
}

// Direct execution
const __filename_check = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename_check) {
  createServer();
}
