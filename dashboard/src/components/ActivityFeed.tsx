import { useEffect, useRef } from "react";
import { useWsEvents } from "../hooks/useWs";
import type { WsEventEntry } from "../hooks/useWs";

const EVENT_LABELS: Record<string, string> = {
  "projects:changed": "Projects updated",
  "manifest:changed": "Manifest changed",
  "lockfile:changed": "Lockfile updated",
  "skills:changed": "Skills updated",
  "memory:changed": "Memory updated",
  "install:progress": "Install in progress",
};

function labelFor(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

function relativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

const container: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
  color: "#8b949e",
  fontSize: 13,
};

const feedList: React.CSSProperties = {
  maxHeight: 200,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const emptyRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const eventRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "4px 0",
  borderBottom: "1px solid #21262d",
};

export function ActivityFeed() {
  const events = useWsEvents();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div style={container}>
        <div style={emptyRow}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#3fb950",
              display: "inline-block",
              flexShrink: 0,
              animation: "pulse 2s infinite",
            }}
          />
          Watching for changes...
        </div>
      </div>
    );
  }

  return (
    <div style={container}>
      <div style={feedList}>
        {events.map((entry: WsEventEntry, i: number) => (
          <div key={i} style={eventRow}>
            <span style={{ color: "#f0f6fc" }}>{labelFor(entry.type)}</span>
            <span style={{ color: "#8b949e", fontSize: 11, flexShrink: 0 }}>
              {relativeTime(entry.timestamp)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
