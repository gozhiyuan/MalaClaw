import { useState } from "react";
import { useProjects, useTeams, useHealth, useSkills, useDiff } from "../hooks/useApi";
import { ProjectCard } from "../components/ProjectCard";
import { AgentList } from "../components/AgentList";
import { SkillTable } from "../components/SkillTable";
import { HealthChecks } from "../components/HealthChecks";
import { KanbanBoard } from "../components/KanbanBoard";
import { ActivityFeed } from "../components/ActivityFeed";
import { CostTracker } from "../components/CostTracker";
import { VirtualOffice } from "../components/VirtualOffice";
import { DiffView } from "../components/DiffView";
import { ManifestForm } from "../components/ManifestForm";
import { TeamGraph } from "../components/TeamGraph";

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 16,
  padding: 16,
};
const section: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
};
const heading: React.CSSProperties = {
  margin: "0 0 12px",
  color: "#f0f6fc",
  fontSize: 14,
  fontWeight: 600,
};
const select: React.CSSProperties = {
  background: "#21262d",
  color: "#f0f6fc",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 13,
};
const wide: React.CSSProperties = { gridColumn: "span 2" };
const full: React.CSSProperties = { gridColumn: "span 3" };

export function Dashboard() {
  const projects = useProjects();
  const teams = useTeams();
  const health = useHealth();
  const skills = useSkills();
  const diff = useDiff();
  const [selectedProject, setSelectedProject] = useState<string>("");

  const projectList = projects.data ?? [];
  const teamList = teams.data ?? [];
  const activeProject = projectList.find((p) => p.id === selectedProject) ?? projectList[0];

  const isLoading = projects.isLoading || teams.isLoading;

  if (isLoading) {
    return (
      <div style={{ padding: 32, color: "#8b949e", textAlign: "center" }}>
        Loading dashboard...
      </div>
    );
  }

  if (projectList.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <h2 style={{ color: "#f0f6fc", marginBottom: 8 }}>No projects found</h2>
        <p style={{ color: "#8b949e" }}>
          Create an openclaw-store.yaml manifest and run install to get started.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Project selector */}
      <div style={{ padding: "16px 16px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <label style={{ color: "#8b949e", fontSize: 13 }}>Project:</label>
        <select
          style={select}
          value={activeProject?.id ?? ""}
          onChange={(e) => setSelectedProject(e.target.value)}
        >
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div style={grid}>
        {/* Row 1 */}
        <div style={{ ...section, ...wide }}>
          {activeProject && <ProjectCard project={activeProject} />}
        </div>
        <div style={section}>
          <h4 style={heading}>Cost</h4>
          <CostTracker />
        </div>

        {/* Row 2 */}
        <div style={section}>
          <h4 style={heading}>Teams & Agents</h4>
          <AgentList teams={teamList} />
        </div>
        <div style={section}>
          <h4 style={heading}>Virtual Office</h4>
          <VirtualOffice teams={teamList} />
        </div>
        <div style={section}>
          <h4 style={heading}>Health</h4>
          <HealthChecks findings={health.data ?? []} />
        </div>

        {/* Row 3 */}
        <div style={{ ...section, ...wide }}>
          <h4 style={heading}>Skills</h4>
          <SkillTable skills={skills.data ?? []} />
        </div>
        <div style={section}>
          <h4 style={heading}>Activity</h4>
          <ActivityFeed />
        </div>

        {/* Row 4 - Kanban full width */}
        {activeProject && (
          <div style={{ ...section, ...full }}>
            <h4 style={heading}>Kanban</h4>
            <KanbanBoard projectId={activeProject.id} teamId={activeProject.entry_team} />
          </div>
        )}

        {/* Row 5 */}
        <div style={section}>
          <h4 style={heading}>Diff</h4>
          <DiffView entries={diff.data ?? []} />
        </div>
        <div style={section}>
          <h4 style={heading}>Manifest</h4>
          <ManifestForm />
        </div>
        <div style={section}>
          <h4 style={heading}>Team Graph</h4>
          {teamList.length > 0 ? (
            <TeamGraph team={teamList[0]} />
          ) : (
            <div style={{ color: "#8b949e" }}>No team data.</div>
          )}
        </div>
      </div>
    </div>
  );
}
