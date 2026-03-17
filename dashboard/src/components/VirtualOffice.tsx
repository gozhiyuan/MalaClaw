import type { Team } from "../lib/types";

const ROLE_CONFIG: Record<string, { color: string; label: string; area: string }> = {
  lead: { color: "#a371f7", label: "Lead", area: "manager-desk" },
  specialist: { color: "#3fb950", label: "Specialist", area: "workstation" },
  reviewer: { color: "#d29922", label: "Reviewer", area: "review-area" },
};

function getRoleConfig(role: string) {
  const key = role.toLowerCase();
  if (key.includes("lead") || key.includes("manager") || key.includes("pm")) {
    return ROLE_CONFIG.lead;
  }
  if (key.includes("review")) {
    return ROLE_CONFIG.reviewer;
  }
  return ROLE_CONFIG.specialist;
}

const roomStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px dashed #30363d",
  borderRadius: 8,
  padding: 12,
};

const roomHeaderStyle: React.CSSProperties = {
  margin: "0 0 10px",
  color: "#f0f6fc",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: "1px solid #30363d",
  paddingBottom: 6,
};

const areaLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#8b949e",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
};

const areaStyle: React.CSSProperties = {
  background: "#0d1117",
  borderRadius: 6,
  padding: "8px 10px",
  minHeight: 52,
};

function AgentAvatar({ agent, role }: { agent: string; role: string }) {
  const cfg = getRoleConfig(role);
  return (
    <div
      title={`${agent} (${role})`}
      style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: "#21262d",
        border: `2px solid ${cfg.color}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        fontWeight: 600,
        color: cfg.color,
        cursor: "default",
      }}
    >
      {agent.charAt(0).toUpperCase()}
    </div>
  );
}

function RoleArea({
  areaLabel,
  members,
}: {
  areaLabel: string;
  members: { agent: string; role: string }[];
}) {
  if (members.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={areaLabelStyle}>{areaLabel}</div>
      <div style={areaStyle}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {members.map((m) => (
            <AgentAvatar key={m.agent} agent={m.agent} role={m.role} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamRoom({ team }: { team: Team }) {
  const leads = team.members.filter((m) => {
    const key = m.role.toLowerCase();
    return key.includes("lead") || key.includes("manager") || key.includes("pm");
  });
  const reviewers = team.members.filter((m) => m.role.toLowerCase().includes("review"));
  const specialists = team.members.filter((m) => {
    const key = m.role.toLowerCase();
    return (
      !key.includes("lead") &&
      !key.includes("manager") &&
      !key.includes("pm") &&
      !key.includes("review")
    );
  });

  return (
    <div style={roomStyle}>
      <h4 style={roomHeaderStyle}>{team.name}</h4>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: leads.length > 0 ? "1fr 2fr 1fr" : "1fr 1fr",
          gap: 8,
        }}
      >
        {leads.length > 0 && (
          <div>
            <RoleArea areaLabel="Manager Desk" members={leads} />
          </div>
        )}
        <div>
          <RoleArea areaLabel="Workstations" members={specialists} />
        </div>
        {reviewers.length > 0 && (
          <div>
            <RoleArea areaLabel="Review Area" members={reviewers} />
          </div>
        )}
      </div>
    </div>
  );
}

export function VirtualOffice({ teams }: { teams: Team[] }) {
  if (teams.length === 0) {
    return <div style={{ color: "#8b949e" }}>No teams loaded.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {teams.map((team) => (
        <TeamRoom key={team.id} team={team} />
      ))}
    </div>
  );
}
