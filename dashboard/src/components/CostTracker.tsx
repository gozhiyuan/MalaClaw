const card: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
};
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "6px 0",
  borderBottom: "1px solid #30363d",
  fontSize: 13,
};

const periods = ["Session", "Day", "Month"] as const;

export function CostTracker() {
  return (
    <div style={card}>
      <h4 style={{ margin: "0 0 8px", color: "#f0f6fc", fontSize: 14 }}>Cost Tracker</h4>
      {periods.map((p) => (
        <div key={p} style={row}>
          <span style={{ color: "#c9d1d9" }}>{p}</span>
          <span style={{ color: "#8b949e" }}>{"\u2014"}</span>
        </div>
      ))}
      <div style={{ color: "#8b949e", fontSize: 11, marginTop: 8 }}>
        Cost tracking not yet connected.
      </div>
    </div>
  );
}
