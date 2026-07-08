import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

type LongWriteResponse = {
  dir: string;
  project: { id?: string; name?: string; mode?: string; artifactType?: string };
  research: { topic?: string; provider?: string };
  review: { cadence: string; time?: string; intervalHours?: number; batchApprovals: boolean };
  workflow: {
    runtime?: string;
    budgetUsd?: number;
    runtimePolicy: Record<string, unknown>;
    modelTiers: Record<string, unknown>;
    stages: Array<{
      id: string;
      title?: string;
      type: "standard" | "foreach";
      owner?: string;
      runtime?: string;
      model?: string;
      modelTier?: string;
      requiresHumanApproval: boolean;
      maxParallel?: number;
      steps: Array<{ id: string; owner?: string; runtime?: string; model?: string; modelTier?: string }>;
      outputs: string[];
    }>;
  };
  flow: {
    status: string;
    updatedAt: string;
    units: Record<string, { status: string }>;
    pendingApprovals: Array<{ id: string; stageId: string }>;
  } | null;
  usage: { totalTokens: number; costUsd: number; unitsWithUsage: number } | null;
  commands: { status: string; run: string; approve: string; packet: string };
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function useLongWrite(dir: string) {
  return useQuery<LongWriteResponse>({
    queryKey: ["longwrite", dir],
    queryFn: () => getJson(`/api/longwrite?dir=${encodeURIComponent(dir)}`),
    enabled: dir.length > 0,
    refetchInterval: 3000,
    retry: false,
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #30363d", borderRadius: 6, padding: 12 }}>
      <h4 style={{ color: "#f0f6fc", margin: "0 0 8px" }}>{title}</h4>
      {children}
    </div>
  );
}

function Command({ value }: { value: string }) {
  return (
    <code style={{
      display: "block",
      color: "#c9d1d9",
      background: "#0d1117",
      border: "1px solid #30363d",
      borderRadius: 6,
      padding: "8px 10px",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      fontSize: 12,
    }}>
      {value}
    </code>
  );
}

function smallLabel(value: string) {
  return <span style={{ color: "#8b949e", fontSize: 12 }}>{value}</span>;
}

export function LongWrite() {
  const [dir, setDir] = useState(() => localStorage.getItem("longwrite-dir") ?? "");
  const [input, setInput] = useState(dir);
  const { data, error, isLoading } = useLongWrite(dir);

  const load = () => {
    localStorage.setItem("longwrite-dir", input);
    localStorage.setItem("malaclaw-flow-dir", input);
    setDir(input);
  };

  const openFlow = () => {
    localStorage.setItem("malaclaw-flow-dir", dir);
  };

  const flowUnits = data?.flow ? Object.values(data.flow.units) : [];
  const succeeded = flowUnits.filter((unit) => unit.status === "succeeded").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1120 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="/absolute/path/to/longwrite-workspace"
          style={{
            flex: 1,
            padding: "6px 10px",
            borderRadius: 6,
            fontFamily: "monospace",
            fontSize: 13,
            background: "#0d1117",
            color: "#c9d1d9",
            border: "1px solid #30363d",
          }}
        />
        <button onClick={load} style={{
          padding: "6px 14px",
          borderRadius: 6,
          border: "1px solid #30363d",
          background: "#1f6feb",
          color: "#fff",
          cursor: "pointer",
        }}>Open</button>
      </div>

      {!dir && <div style={{ color: "#8b949e" }}>Enter a LongWrite workspace directory.</div>}
      {isLoading && dir && <div style={{ color: "#8b949e" }}>Loading LongWrite workspace...</div>}
      {error != null && <div style={{ color: "#f85149" }}>Error: {String(error)}</div>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Section title="Project">
              <div style={{ color: "#c9d1d9", lineHeight: 1.7 }}>
                <div>{smallLabel("name")} {data.project.name ?? data.project.id ?? "unknown"}</div>
                <div>{smallLabel("mode")} {data.project.mode ?? "unknown"}</div>
                <div>{smallLabel("artifact")} {data.project.artifactType ?? "unknown"}</div>
                <div>{smallLabel("topic")} {data.research.topic ?? "not set"}</div>
                <div>{smallLabel("provider")} {data.research.provider ?? "not set"}</div>
              </div>
            </Section>

            <Section title="Run Policy">
              <div style={{ color: "#c9d1d9", lineHeight: 1.7 }}>
                <div>{smallLabel("runtime")} {data.workflow.runtime ?? "CLI option/default"}</div>
                <div>{smallLabel("budget")} {data.workflow.budgetUsd != null ? `$${data.workflow.budgetUsd}` : "not set"}</div>
                <div>{smallLabel("review")} {data.review.cadence}{data.review.time ? ` at ${data.review.time}` : ""}</div>
                <div>{smallLabel("batch approvals")} {data.review.batchApprovals ? "yes" : "no"}</div>
                <div>{smallLabel("model tiers")} {Object.keys(data.workflow.modelTiers).length}</div>
              </div>
            </Section>

            <Section title="Flow">
              <div style={{ color: "#c9d1d9", lineHeight: 1.7 }}>
                <div>{smallLabel("status")} {data.flow?.status ?? "not started"}</div>
                <div>{smallLabel("units")} {data.flow ? `${succeeded}/${flowUnits.length} succeeded` : "no state"}</div>
                <div>{smallLabel("approvals")} {data.flow?.pendingApprovals.length ?? 0}</div>
                <div>{smallLabel("tokens")} {data.usage ? data.usage.totalTokens.toLocaleString() : "unknown"}</div>
                <div>{smallLabel("cost")} {data.usage && data.usage.costUsd > 0 ? `$${data.usage.costUsd.toFixed(4)}` : "unknown"}</div>
              </div>
              <div style={{ marginTop: 8 }}>
                <Link to="/flow" onClick={openFlow} style={{ color: "#58a6ff", fontSize: 13 }}>Open flow monitor</Link>
              </div>
            </Section>
          </div>

          <Section title="Commands">
            <div style={{ display: "grid", gap: 8 }}>
              <Command value={data.commands.status} />
              <Command value={data.commands.run} />
              <Command value={data.commands.approve} />
              <Command value={data.commands.packet} />
            </div>
          </Section>

          <Section title="Stages">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#8b949e", textAlign: "left" }}>
                  <th style={{ padding: "4px 8px" }}>stage</th>
                  <th style={{ padding: "4px 8px" }}>owner</th>
                  <th style={{ padding: "4px 8px" }}>runtime</th>
                  <th style={{ padding: "4px 8px" }}>model</th>
                  <th style={{ padding: "4px 8px" }}>review</th>
                  <th style={{ padding: "4px 8px" }}>outputs</th>
                </tr>
              </thead>
              <tbody>
                {data.workflow.stages.map((stage) => (
                  <tr key={stage.id} style={{ borderTop: "1px solid #21262d" }}>
                    <td style={{ padding: "4px 8px", color: "#c9d1d9", fontFamily: "monospace" }}>
                      {stage.id}
                      {stage.type === "foreach" ? <span style={{ color: "#8b949e" }}> foreach{stage.maxParallel ? ` x${stage.maxParallel}` : ""}</span> : null}
                    </td>
                    <td style={{ padding: "4px 8px", color: "#8b949e" }}>{stage.owner ?? stage.steps.map((s) => s.owner).filter(Boolean).join(", ")}</td>
                    <td style={{ padding: "4px 8px", color: "#8b949e" }}>{stage.runtime ?? stage.steps.map((s) => s.runtime).filter(Boolean).join(", ")}</td>
                    <td style={{ padding: "4px 8px", color: "#8b949e" }}>{stage.model ?? stage.modelTier ?? stage.steps.map((s) => s.model ?? s.modelTier).filter(Boolean).join(", ")}</td>
                    <td style={{ padding: "4px 8px", color: stage.requiresHumanApproval ? "#d29922" : "#8b949e" }}>
                      {stage.requiresHumanApproval ? "gate" : ""}
                    </td>
                    <td style={{ padding: "4px 8px", color: "#8b949e", fontFamily: "monospace", fontSize: 12 }}>
                      {stage.outputs.slice(0, 3).join(", ")}{stage.outputs.length > 3 ? `, +${stage.outputs.length - 3}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  );
}
