import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type LongWriteResponse = {
  dir: string;
  config: ProjectConfig;
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
    pendingApprovals: Array<{ id: string; stageId: string; stepId?: string; itemId?: string; artifacts?: string[] }>;
  } | null;
  usage: { totalTokens: number; costUsd: number; unitsWithUsage: number } | null;
  logs: Array<{ name: string; content: string; truncated: boolean }>;
  operation: {
    running: boolean;
    pid?: number;
    startedAt: string;
    finishedAt?: string;
    exitCode?: number | null;
    signal?: string | null;
    args: string[];
    stdout: string;
    stderr: string;
  } | null;
  commands: { status: string; run: string; approve: string; packet: string };
};

type ProjectConfig = {
  version: 1;
  project: {
    id: string;
    name?: string;
    artifact_type: string;
    mode: string;
  };
  research?: {
    provider?: string;
    topic?: string;
  };
  review?: {
    cadence?: "manual" | "daily" | "interval";
    time?: string;
    interval_hours?: number;
    batch_approvals?: boolean;
  };
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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((payload as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function LongWrite() {
  const [dir, setDir] = useState(() => localStorage.getItem("longwrite-dir") ?? "");
  const [input, setInput] = useState(dir);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [runtimeOverride, setRuntimeOverride] = useState("");
  const [draftConfig, setDraftConfig] = useState<ProjectConfig | null>(null);
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useLongWrite(dir);

  useEffect(() => {
    if (data?.config) setDraftConfig(data.config);
  }, [data?.dir, data?.config]);

  const approve = useMutation({
    mutationFn: (body: { approvalId?: string; batch?: boolean }) =>
      postJson<{ ok: boolean }>("/api/longwrite/approve", { dir, ...body }),
    onSuccess: (_, body) => {
      setOperationMessage(body.batch ? "Approved all pending approvals." : "Approved pending item.");
      queryClient.invalidateQueries({ queryKey: ["longwrite", dir] });
    },
    onError: (err) => setOperationMessage(err instanceof Error ? err.message : String(err)),
  });

  const packet = useMutation({
    mutationFn: () => postJson<{ ok: boolean; artifact: string; stdout?: string }>("/api/longwrite/packet", { dir }),
    onSuccess: (result) => {
      setOperationMessage(`Generated ${result.artifact}.`);
      queryClient.invalidateQueries({ queryKey: ["longwrite", dir] });
    },
    onError: (err) => setOperationMessage(err instanceof Error ? err.message : String(err)),
  });

  const run = useMutation({
    mutationFn: (body: { runtime?: string; reset?: boolean }) =>
      postJson<{ ok: boolean; operation: LongWriteResponse["operation"] }>("/api/longwrite/run", { dir, ...body }),
    onSuccess: (_, body) => {
      setOperationMessage(body.reset ? "Started LongWrite reset run." : "Started LongWrite run.");
      queryClient.invalidateQueries({ queryKey: ["longwrite", dir] });
    },
    onError: (err) => setOperationMessage(err instanceof Error ? err.message : String(err)),
  });

  const saveConfig = useMutation({
    mutationFn: (config: ProjectConfig) =>
      postJson<{ ok: boolean; path: string }>("/api/longwrite/config", { dir, config }),
    onSuccess: () => {
      setOperationMessage("Saved longwrite.yaml.");
      queryClient.invalidateQueries({ queryKey: ["longwrite", dir] });
    },
    onError: (err) => setOperationMessage(err instanceof Error ? err.message : String(err)),
  });

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
  const selectedRuntime = runtimeOverride.trim() || data?.workflow.runtime || undefined;
  const runActive = data?.operation?.running === true;

  const patchConfig = (patch: (current: ProjectConfig) => ProjectConfig) => {
    setDraftConfig((current) => current ? patch(current) : current);
  };

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
      {operationMessage && <div style={{ color: operationMessage.includes("failed") || operationMessage.includes("not found") ? "#f85149" : "#8b949e" }}>{operationMessage}</div>}

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

          <Section title="Operations">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={runtimeOverride}
                onChange={(e) => setRuntimeOverride(e.target.value)}
                placeholder={data.workflow.runtime ? `runtime: ${data.workflow.runtime}` : "runtime override"}
                disabled={runActive}
                style={{
                  minWidth: 180,
                  padding: "6px 10px",
                  borderRadius: 6,
                  fontFamily: "monospace",
                  fontSize: 13,
                  background: "#0d1117",
                  color: "#c9d1d9",
                  border: "1px solid #30363d",
                }}
              />
              <button
                onClick={() => run.mutate({ runtime: selectedRuntime })}
                disabled={runActive || run.isPending}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #30363d",
                  background: runActive ? "#21262d" : "#1f6feb",
                  color: "#fff",
                  cursor: runActive ? "not-allowed" : "pointer",
                }}
              >
                Run
              </button>
              <button
                onClick={() => run.mutate({ runtime: selectedRuntime, reset: true })}
                disabled={runActive || run.isPending}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #30363d",
                  background: runActive ? "#21262d" : "#8957e5",
                  color: "#fff",
                  cursor: runActive ? "not-allowed" : "pointer",
                }}
              >
                Reset + run
              </button>
              <button
                onClick={() => approve.mutate({ batch: true })}
                disabled={!data.flow?.pendingApprovals.length || approve.isPending}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #30363d",
                  background: data.flow?.pendingApprovals.length ? "#238636" : "#21262d",
                  color: "#fff",
                  cursor: data.flow?.pendingApprovals.length ? "pointer" : "not-allowed",
                }}
              >
                Approve all
              </button>
              <button
                onClick={() => packet.mutate()}
                disabled={packet.isPending}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid #30363d",
                  background: "#1f6feb",
                  color: "#fff",
                  cursor: packet.isPending ? "wait" : "pointer",
                }}
              >
                Generate packet
              </button>
            </div>
            {data.flow?.pendingApprovals.length ? (
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {data.flow.pendingApprovals.map((approval) => (
                  <div key={approval.id} style={{ display: "flex", alignItems: "center", gap: 8, color: "#8b949e", fontSize: 13 }}>
                    <button
                      onClick={() => approve.mutate({ approvalId: approval.id })}
                      disabled={approve.isPending}
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid #30363d",
                        background: "#238636",
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Approve
                    </button>
                    <code style={{ color: "#c9d1d9" }}>{approval.id}</code>
                    <span>{[approval.stageId, approval.stepId, approval.itemId].filter(Boolean).join(" / ")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 8, color: "#8b949e", fontSize: 13 }}>No pending approvals.</div>
            )}
            {data.operation && (
              <div style={{ marginTop: 10, color: "#8b949e", fontSize: 13 }}>
                <div>
                  <span style={{ color: data.operation.running ? "#d29922" : data.operation.exitCode === 0 ? "#3fb950" : "#f85149" }}>
                    {data.operation.running ? "running" : `finished ${data.operation.exitCode ?? data.operation.signal ?? "unknown"}`}
                  </span>
                  {" "}started {data.operation.startedAt}
                  {data.operation.pid ? ` · pid ${data.operation.pid}` : ""}
                </div>
                <code style={{ display: "block", marginTop: 4, color: "#c9d1d9" }}>
                  longwrite {data.operation.args.join(" ")}
                </code>
              </div>
            )}
          </Section>

          {draftConfig && (
            <Section title="Config">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <label style={{ color: "#8b949e", fontSize: 12 }}>
                  Project name
                  <input
                    value={draftConfig.project.name ?? ""}
                    onChange={(e) => patchConfig((c) => ({ ...c, project: { ...c.project, name: e.target.value } }))}
                    style={{
                      display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
                      padding: "6px 8px", borderRadius: 6, border: "1px solid #30363d",
                      background: "#0d1117", color: "#c9d1d9",
                    }}
                  />
                </label>
                <label style={{ color: "#8b949e", fontSize: 12 }}>
                  Topic
                  <input
                    value={draftConfig.research?.topic ?? ""}
                    onChange={(e) => patchConfig((c) => ({ ...c, research: { provider: c.research?.provider ?? "seed", ...c.research, topic: e.target.value } }))}
                    style={{
                      display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
                      padding: "6px 8px", borderRadius: 6, border: "1px solid #30363d",
                      background: "#0d1117", color: "#c9d1d9",
                    }}
                  />
                </label>
                <label style={{ color: "#8b949e", fontSize: 12 }}>
                  Provider
                  <select
                    value={draftConfig.research?.provider ?? "seed"}
                    onChange={(e) => patchConfig((c) => ({ ...c, research: { ...c.research, provider: e.target.value } }))}
                    style={{
                      display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
                      padding: "6px 8px", borderRadius: 6, border: "1px solid #30363d",
                      background: "#0d1117", color: "#c9d1d9",
                    }}
                  >
                    <option value="seed">seed</option>
                    <option value="arxiv">arxiv</option>
                    <option value="semantic_scholar">semantic_scholar</option>
                  </select>
                </label>
                <label style={{ color: "#8b949e", fontSize: 12 }}>
                  Review cadence
                  <select
                    value={draftConfig.review?.cadence ?? "manual"}
                    onChange={(e) => patchConfig((c) => ({
                      ...c,
                      review: { time: "08:00", interval_hours: 4, batch_approvals: false, ...c.review, cadence: e.target.value as "manual" | "daily" | "interval" },
                    }))}
                    style={{
                      display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
                      padding: "6px 8px", borderRadius: 6, border: "1px solid #30363d",
                      background: "#0d1117", color: "#c9d1d9",
                    }}
                  >
                    <option value="manual">manual</option>
                    <option value="daily">daily</option>
                    <option value="interval">interval</option>
                  </select>
                </label>
                <label style={{ color: "#8b949e", fontSize: 12 }}>
                  Review time
                  <input
                    value={draftConfig.review?.time ?? "08:00"}
                    onChange={(e) => patchConfig((c) => ({ ...c, review: { cadence: "manual", interval_hours: 4, batch_approvals: false, ...c.review, time: e.target.value } }))}
                    style={{
                      display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
                      padding: "6px 8px", borderRadius: 6, border: "1px solid #30363d",
                      background: "#0d1117", color: "#c9d1d9",
                    }}
                  />
                </label>
                <label style={{ color: "#8b949e", fontSize: 12 }}>
                  Interval hours
                  <input
                    type="number"
                    min={1}
                    value={draftConfig.review?.interval_hours ?? 4}
                    onChange={(e) => patchConfig((c) => ({
                      ...c,
                      review: { cadence: "manual", time: "08:00", batch_approvals: false, ...c.review, interval_hours: Number(e.target.value) },
                    }))}
                    style={{
                      display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
                      padding: "6px 8px", borderRadius: 6, border: "1px solid #30363d",
                      background: "#0d1117", color: "#c9d1d9",
                    }}
                  />
                </label>
                <label style={{ color: "#8b949e", fontSize: 12, display: "flex", gap: 8, alignItems: "center", marginTop: 20 }}>
                  <input
                    type="checkbox"
                    checked={draftConfig.review?.batch_approvals ?? false}
                    onChange={(e) => patchConfig((c) => ({ ...c, review: { cadence: "manual", time: "08:00", interval_hours: 4, ...c.review, batch_approvals: e.target.checked } }))}
                  />
                  Batch approvals
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => saveConfig.mutate(draftConfig)}
                  disabled={saveConfig.isPending}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid #30363d",
                    background: "#238636",
                    color: "#fff",
                    cursor: saveConfig.isPending ? "wait" : "pointer",
                  }}
                >
                  Save config
                </button>
                <button
                  onClick={() => data?.config && setDraftConfig(data.config)}
                  disabled={saveConfig.isPending}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid #30363d",
                    background: "#21262d",
                    color: "#c9d1d9",
                    cursor: "pointer",
                  }}
                >
                  Revert
                </button>
              </div>
            </Section>
          )}

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

          <Section title="Recent logs">
            {data.operation?.stdout || data.operation?.stderr ? (
              <details open={data.operation.running} style={{ marginBottom: 8 }}>
                <summary style={{ color: "#58a6ff", cursor: "pointer", fontFamily: "monospace", fontSize: 13 }}>
                  dashboard-run output
                </summary>
                <pre style={{
                  margin: "6px 0 0",
                  padding: 10,
                  maxHeight: 260,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  color: data.operation.stderr ? "#f85149" : "#c9d1d9",
                  fontSize: 12,
                }}>{[data.operation.stdout, data.operation.stderr].filter(Boolean).join("\n")}</pre>
              </details>
            ) : null}
            {data.logs.length === 0 ? (
              <div style={{ color: "#8b949e", fontSize: 13 }}>No worker logs found.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {data.logs.map((log) => (
                  <details key={log.name} open={data.logs.length === 1}>
                    <summary style={{ color: "#58a6ff", cursor: "pointer", fontFamily: "monospace", fontSize: 13 }}>
                      {log.name}{log.truncated ? " (tail)" : ""}
                    </summary>
                    <pre style={{
                      margin: "6px 0 0",
                      padding: 10,
                      maxHeight: 260,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      background: "#0d1117",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      color: "#c9d1d9",
                      fontSize: 12,
                    }}>{log.content}</pre>
                  </details>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
