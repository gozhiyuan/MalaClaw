import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WsEvent } from "../lib/types";

// ── Module-level event store ──────────────────────────────────────────────────

export interface WsEventEntry {
  type: string;
  timestamp: number;
  data?: unknown;
}

const MAX_EVENTS = 50;

let eventLog: WsEventEntry[] = [];
const subscribers = new Set<() => void>();

function getSnapshot(): WsEventEntry[] {
  return eventLog;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function pushEvent(entry: WsEventEntry): void {
  eventLog = [...eventLog, entry].slice(-MAX_EVENTS);
  subscribers.forEach((cb) => cb());
}

// ── useWsEvents — read-only access to the event log ──────────────────────────

export function useWsEvents(): WsEventEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ── useWs — WebSocket connection + query invalidation ────────────────────────

export function useWs() {
  const qc = useQueryClient();
  const [connectAttempt, setConnectAttempt] = useState(0);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(url);

    ws.onmessage = (e) => {
      try {
        const event: WsEvent = JSON.parse(e.data);
        switch (event.type) {
          case "projects:changed":
            qc.invalidateQueries({ queryKey: ["projects"] });
            break;
          case "manifest:changed":
            qc.invalidateQueries({ queryKey: ["manifest"] });
            qc.invalidateQueries({ queryKey: ["diff"] });
            break;
          case "lockfile:changed":
            qc.invalidateQueries({ queryKey: ["projects"] });
            qc.invalidateQueries({ queryKey: ["agents"] });
            qc.invalidateQueries({ queryKey: ["skills"] });
            break;
          case "skills:changed":
            qc.invalidateQueries({ queryKey: ["skills"] });
            break;
          case "memory:changed":
            qc.invalidateQueries({ queryKey: ["kanban", event.projectId, event.teamId] });
            qc.invalidateQueries({ queryKey: ["log", event.projectId, event.teamId] });
            break;
          case "install:progress":
            break;
        }
        // Push every parsed event into the module-level store
        pushEvent({ type: event.type, timestamp: Date.now(), data: event });
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = () => {
      setTimeout(() => setConnectAttempt((n) => n + 1), 3000);
    };

    return () => {
      ws.close();
    };
  }, [qc, connectAttempt]);
}
