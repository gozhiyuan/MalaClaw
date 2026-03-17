import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project, Agent, Team, Skill, Finding, Starter, DiffEntry, SkillCheckResult } from "../lib/types";

const BASE = "/api";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function useProjects() {
  return useQuery<Project[]>({ queryKey: ["projects"], queryFn: () => fetchJson("/projects") });
}

export function useProject(id: string) {
  return useQuery({ queryKey: ["projects", id], queryFn: () => fetchJson<Project & { lockfile: unknown }>(`/projects/${id}`) });
}

export function useKanban(projectId: string, teamId: string) {
  return useQuery({ queryKey: ["kanban", projectId, teamId], queryFn: () => fetchJson<{ content: string | null }>(`/projects/${projectId}/kanban/${teamId}`) });
}

export function useTaskLog(projectId: string, teamId: string) {
  return useQuery({ queryKey: ["log", projectId, teamId], queryFn: () => fetchJson<{ content: string | null }>(`/projects/${projectId}/log/${teamId}`) });
}

export function useTeams() {
  return useQuery<Team[]>({ queryKey: ["teams"], queryFn: () => fetchJson("/teams") });
}

export function useTeam(id: string) {
  return useQuery<Team>({ queryKey: ["teams", id], queryFn: () => fetchJson(`/teams/${id}`), enabled: !!id });
}

export function useAgents() {
  return useQuery<Agent[]>({ queryKey: ["agents"], queryFn: () => fetchJson("/agents") });
}

export function useAgent(id: string) {
  return useQuery<Agent>({ queryKey: ["agents", id], queryFn: () => fetchJson(`/agents/${id}`), enabled: !!id });
}

export function useSkills() {
  return useQuery<Skill[]>({ queryKey: ["skills"], queryFn: () => fetchJson("/skills") });
}

export function useSkillCheck() {
  return useQuery<SkillCheckResult[]>({ queryKey: ["skillCheck"], queryFn: () => fetchJson("/skills/check") });
}

export function useHealth() {
  return useQuery<Finding[]>({ queryKey: ["health"], queryFn: () => fetchJson("/health") });
}

export function useStarters() {
  return useQuery<Starter[]>({ queryKey: ["starters"], queryFn: () => fetchJson("/starters") });
}

export function useStarter(id: string) {
  return useQuery<Starter>({ queryKey: ["starters", id], queryFn: () => fetchJson(`/starters/${id}`), enabled: !!id });
}

export function useManifest() {
  return useQuery({ queryKey: ["manifest"], queryFn: () => fetchJson("/manifest") });
}

export function useDiff() {
  return useQuery<DiffEntry[]>({ queryKey: ["diff"], queryFn: () => fetchJson("/diff") });
}

export function useSaveManifest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (manifest: unknown) =>
      fetch(`${BASE}/manifest`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manifest) }).then((r) => {
        if (!r.ok) return r.json().then((b: any) => { throw new Error(b.error); });
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manifest"] });
      qc.invalidateQueries({ queryKey: ["diff"] });
    },
  });
}

export function useInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { projectDir?: string }) =>
      fetch(`${BASE}/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => {
        if (!r.ok) return r.json().then((b: any) => { throw new Error(b.error ?? `HTTP ${r.status}`); });
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useInitStarter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; targetDir: string; projectName?: string }) =>
      fetch(`${BASE}/starters/${id}/init`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => {
        if (!r.ok) return r.json().then((b: any) => { throw new Error(b.error ?? `HTTP ${r.status}`); });
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useSyncSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch(`${BASE}/skills/sync`, { method: "POST" }).then((r) => {
        if (!r.ok) return r.json().then((b: any) => { throw new Error(b.error ?? `HTTP ${r.status}`); });
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skillCheck"] });
    },
  });
}
