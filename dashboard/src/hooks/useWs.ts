import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WsEvent } from "../lib/types";

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
