const container: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
  color: "#8b949e",
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

export function ActivityFeed() {
  return (
    <div style={container}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#3fb950",
          display: "inline-block",
          animation: "pulse 2s infinite",
        }}
      />
      Watching for changes...
    </div>
  );
}
