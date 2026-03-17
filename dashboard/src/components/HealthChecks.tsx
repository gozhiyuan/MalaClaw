import type { Finding } from "../lib/types";

const icons: Record<string, { symbol: string; color: string }> = {
  ok: { symbol: "\u2713", color: "#3fb950" },
  warning: { symbol: "\u26A0", color: "#d29922" },
  error: { symbol: "\u2717", color: "#f85149" },
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "6px 0",
  borderBottom: "1px solid #30363d",
};

export function HealthChecks({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <div style={{ color: "#8b949e" }}>No health data yet.</div>;
  }
  return (
    <div>
      {findings.map((f, i) => {
        const icon = icons[f.severity] ?? icons.ok;
        return (
          <div key={`${f.check}-${i}`} style={row}>
            <span style={{ color: icon.color, fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
              {icon.symbol}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#f0f6fc", fontSize: 13 }}>
                <strong>{f.check}</strong>: {f.message}
              </div>
              {f.severity !== "ok" && f.fix && (
                <div style={{ color: "#8b949e", fontSize: 12, marginTop: 2 }}>
                  Fix: {f.fix}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
