import type { Skill } from "../lib/types";

const tierColor: Record<string, string> = {
  trusted: "#3fb950",
  standard: "#58a6ff",
  sandboxed: "#d29922",
  untrusted: "#f85149",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 12px",
  color: "#8b949e",
  fontSize: 12,
  fontWeight: 600,
  borderBottom: "1px solid #30363d",
};
const td: React.CSSProperties = {
  padding: "6px 12px",
  color: "#c9d1d9",
  fontSize: 13,
  borderBottom: "1px solid #30363d",
};

export function SkillTable({ skills }: { skills: Skill[] }) {
  if (skills.length === 0) {
    return <div style={{ color: "#8b949e" }}>No skills registered.</div>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Name</th>
          <th style={th}>Source</th>
          <th style={th}>Trust Tier</th>
        </tr>
      </thead>
      <tbody>
        {skills.map((s) => {
          const tier = s.trust_tier ?? "standard";
          const color = tierColor[tier] ?? "#c9d1d9";
          return (
            <tr key={s.id}>
              <td style={td}>{s.name}</td>
              <td style={td}>{s.source?.type ?? "--"}</td>
              <td style={td}>
                <span
                  style={{
                    background: color + "22",
                    color,
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {tier}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
