import type { DiffEntry } from "../lib/types";

const typeColor: Record<string, string> = {
  added: "#3fb950",
  removed: "#f85149",
  changed: "#d29922",
  unchanged: "#8b949e",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 0",
  borderBottom: "1px solid #30363d",
  fontSize: 13,
};

const typeLabel: React.CSSProperties = {
  borderRadius: 4,
  padding: "1px 6px",
  fontSize: 11,
  fontWeight: 600,
  minWidth: 64,
  textAlign: "center",
  display: "inline-block",
};

export function DiffView({ entries }: { entries: DiffEntry[] }) {
  if (entries.length === 0) {
    return <div style={{ color: "#8b949e" }}>No differences detected.</div>;
  }
  return (
    <div>
      {entries.map((e, i) => {
        const color = typeColor[e.type] ?? "#8b949e";
        return (
          <div key={`${e.kind}-${e.id}-${i}`} style={row}>
            <span style={{ ...typeLabel, background: color + "22", color }}>{e.type}</span>
            <span style={{ color: "#c9d1d9" }}>{e.kind}</span>
            <span style={{ color: "#f0f6fc", fontWeight: 500 }}>{e.id}</span>
            {e.detail && <span style={{ color: "#8b949e", fontSize: 12 }}>{e.detail}</span>}
          </div>
        );
      })}
    </div>
  );
}
