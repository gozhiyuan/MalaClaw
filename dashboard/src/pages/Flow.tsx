import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Flow run debugger: point it at a workspace with a .malaclaw/flow directory
// and watch stage progress, approvals, blockers, usage, logs, and prompts.

type UnitState = {
  status: "pending" | "running" | "succeeded" | "failed";
  attempts: number;
  rounds?: number;
  lastOutcome?: string;
  lastError?: string;
  requestedRuntime?: string;
  actualRuntime?: string;
};

type FlowResponse = {
  dir: string;
  state: {
    status: string;
    units: Record<string, UnitState>;
    pendingApprovals: Array<{ id: string; stageId: string; stepId?: string; itemId?: string; artifacts: string[] }>;
    foreachItems: Record<string, string[]>;
    updatedAt: string;
  } | null;
  stages: Array<{
    id: string;
    title?: string;
    type: "standard" | "foreach" | "loop";
    owner?: string;
    outputs: Array<{ path: string; exists: boolean }>;
  }>;
  loops: Array<{
    id: string;
    title?: string;
    maxRounds: number;
    stopWhen?: string;
    rounds: number;
    status?: string;
    current?: number;
  }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; unitsWithUsage: number };
  usageByUnit: Record<string, { totalTokens: number; costUsd: number }>;
  blockers: Array<{ file: string; excerpt: string }>;
  files: { logs: string[]; prompts: string[] };
  events: Array<{ ts?: string; type: string; key?: string; [k: string]: unknown }>;
};

const colors: Record<string, string> = {
  succeeded: "#3fb950", failed: "#f85149", running: "#d29922", pending: "#8b949e",
  completed: "#3fb950", paused_for_approval: "#d29922", paused_blocker: "#f85149",
};
const marks: Record<string, string> = { succeeded: "✓", failed: "✗", running: "▸", pending: "·" };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function useFlow(dir: string) {
  return useQuery<FlowResponse>({
    queryKey: ["flow", dir],
    queryFn: () => getJson(`/api/flow?dir=${encodeURIComponent(dir)}`),
    enabled: dir.length > 0,
    refetchInterval: 2500,
    retry: false,
  });
}

function FileViewer({ dir, kind, name, onClose }: { dir: string; kind: string; name: string; onClose: () => void }) {
  const { data, error } = useQuery<{ name: string; content: string; truncated: boolean }>({
    queryKey: ["flow-file", dir, kind, name],
    queryFn: () => getJson(`/api/flow/file?dir=${encodeURIComponent(dir)}&kind=${kind}&name=${encodeURIComponent(name)}`),
  });
  return (
    <div style={{ border: "1px solid #30363d", borderRadius: 6, marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "#161b22" }}>
        <span style={{ color: "#f0f6fc", fontFamily: "monospace", fontSize: 13 }}>
          {kind}/{name}{data?.truncated ? " (tail)" : ""}
        </span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer" }}>✕</button>
      </div>
      <pre style={{
        margin: 0, padding: 10, maxHeight: 360, overflow: "auto",
        fontSize: 12, color: "#c9d1d9", whiteSpace: "pre-wrap",
      }}>{error ? String(error) : data?.content ?? "Loading…"}</pre>
    </div>
  );
}

type UnitRow =
  | { kind: "header"; id: string; label: string; tokens: number; cost: number }
  | { kind: "unit"; id: string; unit: UnitState; indent: boolean };

/** Order units for display: non-loop units first (state order), then each
 *  loop's rounds as grouped sections with per-round token/cost sums. */
function groupUnitRows(
  units: Record<string, UnitState>,
  loops: FlowResponse["loops"],
  usageByUnit: FlowResponse["usageByUnit"],
): UnitRow[] {
  const loopRoundKey = (key: string): { loopId: string; round: number } | null => {
    for (const loop of loops) {
      const match = key.match(new RegExp(`^${loop.id}-r(\\d+)-`));
      if (match) return { loopId: loop.id, round: Number(match[1]) };
    }
    return null;
  };

  const rows: UnitRow[] = [];
  const grouped = new Map<string, string[]>();
  for (const key of Object.keys(units)) {
    const inLoop = loopRoundKey(key);
    if (!inLoop) {
      rows.push({ kind: "unit", id: key, unit: units[key], indent: false });
      continue;
    }
    const groupId = `${inLoop.loopId}-r${inLoop.round}`;
    if (!grouped.has(groupId)) grouped.set(groupId, []);
    grouped.get(groupId)!.push(key);
  }

  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  for (const [groupId, keys] of sortedGroups) {
    let tokens = 0;
    let cost = 0;
    for (const key of keys) {
      tokens += usageByUnit[key]?.totalTokens ?? 0;
      cost += usageByUnit[key]?.costUsd ?? 0;
    }
    const round = groupId.match(/-r(\d+)$/)?.[1];
    const loopId = groupId.replace(/-r\d+$/, "");
    rows.push({ kind: "header", id: groupId, label: `${loopId} · round ${round}`, tokens, cost });
    for (const key of keys) rows.push({ kind: "unit", id: key, unit: units[key], indent: true });
  }
  return rows;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #30363d", borderRadius: 6, padding: 12 }}>
      <h4 style={{ color: "#f0f6fc", margin: "0 0 8px" }}>{title}</h4>
      {children}
    </div>
  );
}

export function Flow() {
  const [dir, setDir] = useState(() => localStorage.getItem("malaclaw-flow-dir") ?? "");
  const [input, setInput] = useState(dir);
  const [viewing, setViewing] = useState<{ kind: string; name: string } | null>(null);
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useFlow(dir);

  const approve = useMutation({
    mutationFn: (approvalId: string) =>
      fetch("/api/flow/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir, approvalId }),
      }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["flow", dir] }),
  });

  const load = () => {
    localStorage.setItem("malaclaw-flow-dir", input);
    setDir(input);
    setViewing(null);
  };

  const state = data?.state ?? null;
  const statusColor = state ? colors[state.status] ?? "#c9d1d9" : "#8b949e";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="/absolute/path/to/workspace (contains .malaclaw/flow)"
          style={{
            flex: 1, padding: "6px 10px", borderRadius: 6, fontFamily: "monospace", fontSize: 13,
            background: "#0d1117", color: "#c9d1d9", border: "1px solid #30363d",
          }}
        />
        <button onClick={load} style={{
          padding: "6px 14px", borderRadius: 6, border: "1px solid #30363d",
          background: "#1f6feb", color: "#fff", cursor: "pointer",
        }}>Open</button>
      </div>

      {!dir && <div style={{ color: "#8b949e" }}>Enter a workspace directory to inspect its flow.</div>}
      {error != null && <div style={{ color: "#f85149" }}>Error: {String(error)}</div>}
      {isLoading && dir && <div style={{ color: "#8b949e" }}>Loading flow state…</div>}

      {data && !state && dir && !isLoading && (
        <div style={{ color: "#d29922" }}>No flow state at {dir}/.malaclaw/flow — run `malaclaw flow run` first.</div>
      )}

      {state && (
        <>
          <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 18, fontWeight: 600, color: statusColor }}>
              {state.status}
            </span>
            <span style={{ color: "#8b949e", fontSize: 13 }}>updated {state.updatedAt}</span>
            {data!.usage.unitsWithUsage > 0 && (
              <span style={{ color: "#c9d1d9", fontSize: 13 }}>
                Σ {data!.usage.totalTokens.toLocaleString()} tokens
                {data!.usage.costUsd > 0 ? ` · $${data!.usage.costUsd.toFixed(4)}` : ""}
                {" "}across {data!.usage.unitsWithUsage} units
              </span>
            )}
          </div>

          {state.pendingApprovals.length > 0 && (
            <Section title={`Pending approvals (${state.pendingApprovals.length})`}>
              {state.pendingApprovals.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "4px 0" }}>
                  <button
                    onClick={() => approve.mutate(a.id)}
                    disabled={approve.isPending}
                    style={{
                      padding: "4px 12px", borderRadius: 6, border: "none",
                      background: "#238636", color: "#fff", cursor: "pointer",
                    }}>Approve</button>
                  <span style={{ color: "#c9d1d9", fontFamily: "monospace", fontSize: 13 }}>{a.id}</span>
                  <span style={{ color: "#8b949e", fontSize: 13 }}>
                    {[a.stageId, a.stepId, a.itemId].filter(Boolean).join(" / ")}
                    {a.artifacts.length > 0 ? ` — ${a.artifacts.join(", ")}` : ""}
                  </span>
                </div>
              ))}
            </Section>
          )}

          {data!.blockers.length > 0 && (
            <Section title={`Blockers (${data!.blockers.length})`}>
              {data!.blockers.map((b) => (
                <details key={b.file} style={{ color: "#f85149", fontSize: 13, padding: "2px 0" }}>
                  <summary style={{ cursor: "pointer" }}>{b.file}</summary>
                  <pre style={{ color: "#c9d1d9", fontSize: 12, whiteSpace: "pre-wrap" }}>{b.excerpt}</pre>
                </details>
              ))}
            </Section>
          )}

          {data!.loops.length > 0 && (
            <Section title="Loops">
              {data!.loops.map((loop) => (
                <div key={loop.id} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "3px 0", fontSize: 13, flexWrap: "wrap" }}>
                  <span style={{ color: "#c9d1d9", fontFamily: "monospace" }}>{loop.id}</span>
                  <span style={{ color: colors[loop.status ?? ""] ?? "#8b949e" }}>{loop.status ?? "pending"}</span>
                  <span style={{ color: "#8b949e" }}>round {loop.rounds} / {loop.maxRounds}</span>
                  {loop.stopWhen && (
                    <span style={{ color: "#8b949e" }}>
                      stop when <span style={{ fontFamily: "monospace", color: "#c9d1d9" }}>{loop.stopWhen}</span>
                      {loop.current !== undefined && (
                        <> — current <span style={{ color: "#d29922", fontWeight: 600 }}>{loop.current}</span></>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </Section>
          )}

          <Section title="Units">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#8b949e", textAlign: "left" }}>
                  <th style={{ padding: "4px 8px" }}></th>
                  <th style={{ padding: "4px 8px" }}>unit</th>
                  <th style={{ padding: "4px 8px" }}>status</th>
                  <th style={{ padding: "4px 8px" }}>attempts</th>
                  <th style={{ padding: "4px 8px" }}>rounds</th>
                  <th style={{ padding: "4px 8px" }}>runtime</th>
                  <th style={{ padding: "4px 8px" }}>tokens</th>
                  <th style={{ padding: "4px 8px" }}>last error</th>
                </tr>
              </thead>
              <tbody>
                {groupUnitRows(state.units, data!.loops, data!.usageByUnit).map((row) =>
                  row.kind === "header" ? (
                    <tr key={row.id} style={{ borderTop: "1px solid #30363d", background: "#161b22" }}>
                      <td colSpan={8} style={{ padding: "4px 8px", color: "#58a6ff", fontSize: 12 }}>
                        {row.label}
                        {row.tokens > 0 && (
                          <span style={{ color: "#8b949e" }}>
                            {" "}— {row.tokens.toLocaleString()} tokens{row.cost > 0 ? ` · $${row.cost.toFixed(4)}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.id} style={{ borderTop: "1px solid #21262d" }}>
                      <td style={{ padding: "4px 8px", color: colors[row.unit.status] }}>{marks[row.unit.status]}</td>
                      <td style={{ padding: `4px 8px 4px ${row.indent ? 24 : 8}px`, color: "#c9d1d9", fontFamily: "monospace" }}>{row.id}</td>
                      <td style={{ padding: "4px 8px", color: colors[row.unit.status] }}>{row.unit.status}</td>
                      <td style={{ padding: "4px 8px", color: "#8b949e" }}>{row.unit.attempts}</td>
                      <td style={{ padding: "4px 8px", color: "#8b949e" }}>{row.unit.rounds ?? 0}</td>
                      <td style={{ padding: "4px 8px", color: "#8b949e" }}>{row.unit.actualRuntime ?? ""}</td>
                      <td style={{ padding: "4px 8px", color: "#8b949e" }}>
                        {data!.usageByUnit[row.id]?.totalTokens ? data!.usageByUnit[row.id].totalTokens.toLocaleString() : ""}
                      </td>
                      <td style={{ padding: "4px 8px", color: "#f85149", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.unit.lastError ?? ""}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </Section>

          {data!.stages.length > 0 && (
            <Section title="Artifacts">
              {data!.stages.map((s) => (
                <div key={s.id} style={{ padding: "2px 0", fontSize: 13 }}>
                  <span style={{ color: "#c9d1d9", fontFamily: "monospace" }}>{s.id}</span>
                  <span style={{ color: "#8b949e" }}>{s.title ? ` — ${s.title}` : ""}{s.owner ? ` (${s.owner})` : ""}</span>
                  <span style={{ marginLeft: 8 }}>
                    {s.outputs.map((o) => (
                      <span key={o.path} style={{
                        color: o.exists ? "#3fb950" : "#8b949e",
                        fontFamily: "monospace", fontSize: 12, marginRight: 10,
                      }}>
                        {o.exists ? "●" : "○"} {o.path}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </Section>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {(["logs", "prompts"] as const).map((kind) => (
              <Section key={kind} title={kind === "logs" ? "Worker logs" : "Rendered prompts"}>
                <div style={{ maxHeight: 180, overflow: "auto" }}>
                  {data!.files[kind].length === 0 && <span style={{ color: "#8b949e", fontSize: 13 }}>none</span>}
                  {data!.files[kind].map((name) => (
                    <div key={name}>
                      <button
                        onClick={() => setViewing({ kind, name })}
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: "1px 0",
                          color: "#58a6ff", fontFamily: "monospace", fontSize: 12,
                        }}>{name}</button>
                    </div>
                  ))}
                </div>
              </Section>
            ))}
          </div>
          {viewing && <FileViewer dir={dir} kind={viewing.kind} name={viewing.name} onClose={() => setViewing(null)} />}

          <Section title="Recent events">
            <div style={{ maxHeight: 240, overflow: "auto", fontFamily: "monospace", fontSize: 12 }}>
              {[...data!.events].reverse().map((e, i) => (
                <div key={i} style={{ color: "#8b949e", padding: "1px 0" }}>
                  <span style={{ color: "#484f58" }}>{e.ts?.slice(11, 19)}</span>{" "}
                  <span style={{ color: e.type.includes("fail") || e.type.includes("blocker") ? "#f85149" : e.type.includes("succeeded") || e.type.includes("completed") ? "#3fb950" : "#c9d1d9" }}>
                    {e.type}
                  </span>
                  {e.key != null && <span> {String(e.key)}</span>}
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
