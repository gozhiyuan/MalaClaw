import { useManifest, useInstall } from "../hooks/useApi";

const card: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
};
const pre: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 4,
  padding: 12,
  color: "#c9d1d9",
  fontSize: 12,
  overflow: "auto",
  maxHeight: 300,
  margin: "8px 0",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
const btn: React.CSSProperties = {
  background: "#238636",
  color: "#f0f6fc",
  border: "none",
  borderRadius: 6,
  padding: "6px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export function ManifestForm() {
  const { data, isLoading, error } = useManifest();
  const install = useInstall();

  if (isLoading) return <div style={{ color: "#8b949e" }}>Loading manifest...</div>;
  if (error) return <div style={{ color: "#f85149" }}>Error loading manifest.</div>;

  return (
    <div style={card}>
      <h4 style={{ margin: "0 0 4px", color: "#f0f6fc", fontSize: 14 }}>Manifest</h4>
      <pre style={pre}>{JSON.stringify(data, null, 2)}</pre>
      <button
        style={{
          ...btn,
          opacity: install.isPending ? 0.6 : 1,
        }}
        disabled={install.isPending}
        onClick={() => install.mutate({})}
      >
        {install.isPending ? "Installing..." : "Install"}
      </button>
      {install.isError && (
        <div style={{ color: "#f85149", fontSize: 12, marginTop: 6 }}>
          Install failed: {String(install.error)}
        </div>
      )}
      {install.isSuccess && (
        <div style={{ color: "#3fb950", fontSize: 12, marginTop: 6 }}>Install complete.</div>
      )}
    </div>
  );
}
