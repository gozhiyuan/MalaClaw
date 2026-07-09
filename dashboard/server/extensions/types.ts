import type { FastifyPluginAsync } from "fastify";

export type DashboardServerExtensionHost = {
  loadFlowState: (workspaceDir: string) => Promise<unknown>;
  logsDir: (workspaceDir: string) => string;
  approveAllFlow: (workspaceDir: string) => Promise<unknown>;
  approveFlow: (workspaceDir: string, approvalId: string) => Promise<unknown>;
  summarizeUsage: (workspaceDir: string) => Promise<unknown>;
};

export type DashboardServerExtension = {
  id: string;
  routes: FastifyPluginAsync;
};

export type DashboardServerExtensionFactory = (
  host: DashboardServerExtensionHost,
) => DashboardServerExtension | Promise<DashboardServerExtension>;
