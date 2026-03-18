import WebSocket from "ws";

export interface GatewayConfig { url: string; reconnectMs?: number }
export interface AgentStatus { agentId: string; status: "idle" | "active" | "spawning"; sessionId?: string; updatedAt: number }
export interface UsageSummary { input_tokens: number; output_tokens: number; total_cost: number }

export class GatewayClient {
  private ws: WebSocket | null = null;
  private statuses = new Map<string, AgentStatus>();
  private usage: UsageSummary = { input_tokens: 0, output_tokens: 0, total_cost: 0 };
  private config: Required<GatewayConfig>;
  private onEvent?: (event: { type: string; data: unknown }) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: GatewayConfig) {
    this.config = { reconnectMs: 5000, ...config };
  }

  connect(onEvent?: (event: { type: string; data: unknown }) => void) {
    this.onEvent = onEvent;
    this.tryConnect();
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  getAgentStatuses() { return new Map(this.statuses); }
  getUsage() { return { ...this.usage }; }

  private tryConnect() {
    try {
      this.ws = new WebSocket(this.config.url);
      this.ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(msg);
        } catch { /* ignore malformed */ }
      });
      this.ws.on("close", () => {
        this.reconnectTimer = setTimeout(() => this.tryConnect(), this.config.reconnectMs);
      });
      this.ws.on("error", () => { this.ws?.close(); });
    } catch {
      this.reconnectTimer = setTimeout(() => this.tryConnect(), this.config.reconnectMs);
    }
  }

  private handleMessage(msg: { type: string; data?: Record<string, unknown> }) {
    if (msg.type === "agent:status" && msg.data) {
      const d = msg.data as unknown as AgentStatus;
      this.statuses.set(d.agentId, d);
    }
    if (msg.type === "usage:update" && msg.data) {
      const d = msg.data as unknown as UsageSummary;
      this.usage = d;
    }
    this.onEvent?.({ type: msg.type, data: msg.data });
  }
}
