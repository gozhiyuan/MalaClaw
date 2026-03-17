import { useState } from "react";
import type { Project, Team } from "../lib/types";
import { useProjects, useProject, useTeams } from "../hooks/useApi";
import { AgentList } from "../components/AgentList";
import { KanbanBoard } from "../components/KanbanBoard";
import { TeamGraph } from "../components/TeamGraph";

function ProjectDetail({ project }: { project: Project }) {
  const { data: detail, isLoading } = useProject(project.id);
  const { data: allTeams } = useTeams();

  if (isLoading) return <div style={{ color: "#8b949e", padding: 12 }}>Loading project detail...</div>;

  const projectTeams: Team[] = (allTeams ?? []).filter((t) =>
    project.packs.some((p) => t.id.includes(p)) || t.id === project.entry_team
  );

  return (
    <div style={{ padding: "12px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      {detail?.description && (
        <p style={{ color: "#c9d1d9", margin: 0 }}>{detail.description}</p>
      )}
      <div style={{ color: "#8b949e", fontSize: 13 }}>
        <span>Dir: {project.project_dir}</span>
        {" | "}
        <span>Entry team: {project.entry_team}</span>
      </div>

      {projectTeams.length > 0 && (
        <div>
          <h4 style={{ color: "#f0f6fc", margin: "0 0 8px" }}>Team Members</h4>
          <AgentList teams={projectTeams} />
        </div>
      )}

      <div>
        <h4 style={{ color: "#f0f6fc", margin: "0 0 8px" }}>Kanban</h4>
        <KanbanBoard projectId={project.id} teamId={project.entry_team} />
      </div>

      {projectTeams.map((team) => (
        <div key={team.id}>
          <h4 style={{ color: "#f0f6fc", margin: "0 0 8px" }}>Graph: {team.name}</h4>
          <TeamGraph team={team} />
        </div>
      ))}
    </div>
  );
}

export function Projects() {
  const { data: projects, isLoading, error } = useProjects();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (isLoading) return <div style={{ color: "#8b949e", padding: 24 }}>Loading projects...</div>;
  if (error) return <div style={{ color: "#f85149", padding: 24 }}>Error: {(error as Error).message}</div>;
  if (!projects || projects.length === 0) {
    return (
      <div style={{ color: "#8b949e", padding: 24, textAlign: "center" }}>
        No projects installed. Browse starters to get started.
      </div>
    );
  }

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ color: "#f0f6fc", margin: "0 0 8px" }}>Projects</h2>
      {projects.map((p) => (
        <div
          key={p.id}
          style={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <div
            onClick={() => toggle(p.id)}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
          >
            <span style={{ color: "#8b949e", fontSize: 12, width: 16, textAlign: "center" }}>
              {expanded[p.id] ? "\u25BC" : "\u25B6"}
            </span>
            <span style={{ color: "#f0f6fc", fontWeight: 600 }}>{p.name}</span>
            <span style={{ color: "#8b949e", fontSize: 13 }}>{p.id}</span>
            {p.packs.map((pk) => (
              <span
                key={pk}
                style={{
                  background: "#21262d",
                  color: "#a371f7",
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 10,
                }}
              >
                {pk}
              </span>
            ))}
          </div>
          {expanded[p.id] && <ProjectDetail project={p} />}
        </div>
      ))}
    </div>
  );
}
