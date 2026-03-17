import type { Team } from "../lib/types";

const roleColor: Record<string, string> = {
  lead: "#a371f7",
  specialist: "#3fb950",
  reviewer: "#d29922",
};

const card: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
};
const badge: React.CSSProperties = {
  borderRadius: 4,
  padding: "2px 8px",
  fontSize: 11,
  fontWeight: 600,
};

export function AgentList({ teams }: { teams: Team[] }) {
  if (teams.length === 0) {
    return <div style={{ color: "#8b949e" }}>No teams loaded.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {teams.map((team) => (
        <div key={team.id} style={card}>
          <h4 style={{ margin: "0 0 8px", color: "#f0f6fc", fontSize: 14 }}>{team.name}</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {team.members.map((m) => {
              const color = roleColor[m.role] ?? "#c9d1d9";
              return (
                <div key={m.agent} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ ...badge, background: color + "22", color }}>{m.role}</span>
                  <span style={{ color: "#f0f6fc", fontSize: 13 }}>{m.agent}</span>
                  {m.entry_point && (
                    <span
                      style={{
                        ...badge,
                        background: "#58a6ff22",
                        color: "#58a6ff",
                      }}
                    >
                      entry
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
