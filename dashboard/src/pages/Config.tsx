import { useManifest, useDiff, useInstall } from "../hooks/useApi";
import { DiffView } from "../components/DiffView";

export function Config() {
  const { data: manifest, isLoading: manifestLoading } = useManifest();
  const { data: diffEntries, isLoading: diffLoading } = useDiff();
  const installMutation = useInstall();

  return (
    <div>
      <h2 style={{ color: "#f0f6fc", margin: "0 0 12px" }}>Config</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Left: manifest JSON */}
        <div>
          <h3 style={{ color: "#c9d1d9", margin: "0 0 8px", fontSize: 14 }}>Current Manifest</h3>
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 16,
              maxHeight: 500,
              overflow: "auto",
            }}
          >
            {manifestLoading ? (
              <span style={{ color: "#8b949e" }}>Loading manifest...</span>
            ) : manifest ? (
              <pre style={{ color: "#c9d1d9", margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(manifest, null, 2)}
              </pre>
            ) : (
              <span style={{ color: "#8b949e" }}>No manifest found.</span>
            )}
          </div>
        </div>

        {/* Right: diff preview */}
        <div>
          <h3 style={{ color: "#c9d1d9", margin: "0 0 8px", fontSize: 14 }}>Diff Preview</h3>
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 16,
              maxHeight: 500,
              overflow: "auto",
            }}
          >
            {diffLoading ? (
              <span style={{ color: "#8b949e" }}>Loading diff...</span>
            ) : diffEntries && diffEntries.length > 0 ? (
              <DiffView entries={diffEntries} />
            ) : (
              <span style={{ color: "#8b949e" }}>No changes detected.</span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom: install button */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={() => installMutation.mutate({})}
          disabled={installMutation.isPending}
          style={{
            padding: "8px 24px",
            background: "#238636",
            color: "#f0f6fc",
            border: "none",
            borderRadius: 6,
            cursor: installMutation.isPending ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: 14,
            opacity: installMutation.isPending ? 0.6 : 1,
          }}
        >
          {installMutation.isPending ? "Installing..." : "Install"}
        </button>
        {installMutation.isSuccess && (
          <span style={{ color: "#3fb950", fontSize: 13 }}>Install completed successfully.</span>
        )}
        {installMutation.isError && (
          <span style={{ color: "#f85149", fontSize: 13 }}>
            Install failed: {(installMutation.error as Error).message}
          </span>
        )}
      </div>
    </div>
  );
}
