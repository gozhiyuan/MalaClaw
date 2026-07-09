import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const modulePath = (name: string) => path.join(rootDir, "node_modules", name);

export default defineConfig({
  plugins: [react()],
  root: ".",
  resolve: {
    alias: {
      react: modulePath("react"),
      "react-dom": modulePath("react-dom"),
      "react-router-dom": modulePath("react-router-dom"),
      "@tanstack/react-query": modulePath("@tanstack/react-query"),
    },
  },
  build: {
    outDir: "dist/client",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3456",
      "/ws": {
        target: "ws://localhost:3456",
        ws: true,
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
