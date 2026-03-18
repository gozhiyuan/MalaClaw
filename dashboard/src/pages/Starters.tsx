import { useState } from "react";
import { useStarters, useInitStarter } from "../hooks/useApi";
import { ErrorBoundary } from "../components/ErrorBoundary";

export function Starters() {
  const { data: starters, isLoading, error } = useStarters();
  const initMutation = useInitStarter();
  const [search, setSearch] = useState("");

  if (isLoading) return <div style={{ color: "#8b949e", padding: 24 }}>Loading starters...</div>;
  if (error) return <div style={{ color: "#f85149", padding: 24 }}>Error: {(error as Error).message}</div>;
  if (!starters || starters.length === 0) {
    return <div style={{ color: "#8b949e", padding: 24, textAlign: "center" }}>No starters available.</div>;
  }

  const q = search.toLowerCase();
  const filtered = starters.filter((s) => {
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q) ||
      (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  });

  const handleInit = (id: string) => {
    const targetDir = window.prompt("Target directory for this starter:");
    if (!targetDir) return;
    initMutation.mutate({ id, targetDir });
  };

  return (
    <div>
      <h2 style={{ color: "#f0f6fc", margin: "0 0 12px" }}>Starters</h2>
      <input
        type="text"
        placeholder="Search starters..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 12px",
          marginBottom: 16,
          background: "#0d1117",
          border: "1px solid #30363d",
          borderRadius: 6,
          color: "#f0f6fc",
          fontSize: 14,
          boxSizing: "border-box",
        }}
      />

      {initMutation.isSuccess && (
        <div style={{ color: "#3fb950", marginBottom: 12, fontSize: 13 }}>Starter initialized successfully.</div>
      )}
      {initMutation.isError && (
        <div style={{ color: "#f85149", marginBottom: 12, fontSize: 13 }}>
          Init failed: {(initMutation.error as Error).message}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ color: "#8b949e", textAlign: "center", padding: 24 }}>No starters match your search.</div>
      ) : (
        <ErrorBoundary name="StarterGrid">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {filtered.map((s) => (
            <div
              key={s.id}
              style={{
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 8,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ color: "#f0f6fc", fontWeight: 600, fontSize: 15 }}>{s.name}</div>
              {s.description && (
                <div style={{ color: "#c9d1d9", fontSize: 13, flex: 1 }}>{s.description}</div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(s.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    style={{
                      background: "#21262d",
                      color: "#58a6ff",
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 10,
                    }}
                  >
                    {tag}
                  </span>
                ))}
                {(s.required_apis ?? []).map((api) => (
                  <span
                    key={api}
                    style={{
                      background: "#21262d",
                      color: "#d29922",
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 10,
                    }}
                  >
                    {api}
                  </span>
                ))}
              </div>
              <button
                onClick={() => handleInit(s.id)}
                disabled={initMutation.isPending}
                style={{
                  marginTop: 4,
                  padding: "6px 16px",
                  background: "#238636",
                  color: "#f0f6fc",
                  border: "none",
                  borderRadius: 6,
                  cursor: initMutation.isPending ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                  opacity: initMutation.isPending ? 0.6 : 1,
                }}
              >
                {initMutation.isPending ? "Initializing..." : "Init"}
              </button>
            </div>
          ))}
        </div>
        </ErrorBoundary>
      )}
    </div>
  );
}
