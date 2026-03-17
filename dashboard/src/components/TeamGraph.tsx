import type { Team } from "../lib/types";

const NODE_R = 24;
const W = 400;
const H = 260;

export function TeamGraph({ team }: { team: Team }) {
  const members = team.members.map((m) => m.agent);
  const edges = team.graph ?? [];

  if (members.length === 0) {
    return <div style={{ color: "#8b949e" }}>No members in team.</div>;
  }

  // Lay out nodes in a circle
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) / 2 - NODE_R - 20;
  const positions: Record<string, { x: number; y: number }> = {};
  members.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / members.length - Math.PI / 2;
    positions[id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  return (
    <svg width={W} height={H} style={{ background: "#161b22", borderRadius: 8 }}>
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6" fill="#58a6ff" />
        </marker>
      </defs>
      {edges.map((e, i) => {
        const from = positions[e.from];
        const to = positions[e.to];
        if (!from || !to) return null;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        return (
          <line
            key={i}
            x1={from.x + ux * NODE_R}
            y1={from.y + uy * NODE_R}
            x2={to.x - ux * (NODE_R + 8)}
            y2={to.y - uy * (NODE_R + 8)}
            stroke="#58a6ff"
            strokeWidth={1.5}
            markerEnd="url(#arrow)"
          />
        );
      })}
      {members.map((id) => {
        const pos = positions[id];
        return (
          <g key={id}>
            <circle cx={pos.x} cy={pos.y} r={NODE_R} fill="#21262d" stroke="#30363d" strokeWidth={2} />
            <text
              x={pos.x}
              y={pos.y + 4}
              textAnchor="middle"
              fill="#f0f6fc"
              fontSize={11}
              fontWeight={600}
            >
              {id.length > 8 ? id.slice(0, 7) + ".." : id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
