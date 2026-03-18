import { describe, it, expect } from "vitest";
import { GatewayClient } from "../services/gateway.js";

describe("GatewayClient", () => {
  it("exposes connect/disconnect methods", () => {
    const client = new GatewayClient({ url: "ws://localhost:18789" });
    expect(client.connect).toBeDefined();
    expect(client.disconnect).toBeDefined();
  });

  it("provides getAgentStatuses() returning a map", () => {
    const client = new GatewayClient({ url: "ws://localhost:18789" });
    expect(client.getAgentStatuses()).toEqual(new Map());
  });

  it("provides getUsage() returning empty usage", () => {
    const client = new GatewayClient({ url: "ws://localhost:18789" });
    expect(client.getUsage()).toEqual({ input_tokens: 0, output_tokens: 0, total_cost: 0 });
  });
});
