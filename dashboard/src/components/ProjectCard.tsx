import type { Project } from "../lib/types";

const card: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
};
const badge: React.CSSProperties = {
  background: "#21262d",
  color: "#c9d1d9",
  borderRadius: 4,
  padding: "2px 8px",
  fontSize: 12,
  marginRight: 6,
};

export function ProjectCard({ project }: { project: Project }) {
  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 4px", color: "#f0f6fc", fontSize: 16 }}>{project.name}</h3>
      {project.description && (
        <p style={{ margin: "0 0 8px", color: "#8b949e", fontSize: 13 }}>{project.description}</p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        <span style={badge}>Entry: {project.entry_team}</span>
        <span style={badge}>Packs: {project.packs.length}</span>
        <span style={badge}>Skills: {project.skills.length}</span>
      </div>
      {project.entry_points.length > 0 && (
        <div style={{ fontSize: 12, color: "#8b949e" }}>
          Entry points: {project.entry_points.map((ep) => ep.agent_name).join(", ")}
        </div>
      )}
    </div>
  );
}
