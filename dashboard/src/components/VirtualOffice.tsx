import type { Team } from "../lib/types";

const room: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 12,
};
const avatar: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "#21262d",
  border: "2px solid #30363d",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  fontWeight: 600,
  color: "#f0f6fc",
};

export function VirtualOffice({ teams }: { teams: Team[] }) {
  if (teams.length === 0) {
    return <div style={{ color: "#8b949e" }}>No teams loaded.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {teams.map((team) => (
        <div key={team.id} style={room}>
          <h4 style={{ margin: "0 0 8px", color: "#f0f6fc", fontSize: 13 }}>{team.name}</h4>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {team.members.map((m) => (
              <div
                key={m.agent}
                style={avatar}
                title={m.agent}
              >
                {m.agent.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
