import { describe, it, expect } from "vitest";
import { resolveManifest } from "../src/lib/resolver.js";

describe("resolveManifest with workflow", () => {
  it("resolves a manifest whose workflow owners exist in the pack", async () => {
    const result = await resolveManifest(
      {
        version: 1,
        runtime: "openclaw",
        packs: [{ id: "dev-company" }],
        skills: [],
        workflow: {
          external_inputs: [],
          max_parallel: 2,
          stages: [
            { id: "plan", owner: "pm", inputs: [], optional_inputs: [], outputs: ["plan.md"], tools: [], validators: [], requires_human_approval: false },
            { id: "build", owner: "tech-lead", inputs: ["plan.md"], optional_inputs: [], outputs: ["src/*.ts"], tools: [], validators: [], requires_human_approval: false },
          ],
        },
      },
      { projectDir: "/tmp/acme-web" },
    );
    expect(result.workflow).toBeDefined();
    expect(result.workflow?.stages).toHaveLength(2);
    expect(result.workflowWarnings).toEqual([]);
  });

  it("surfaces input-provenance warnings without failing", async () => {
    const result = await resolveManifest(
      {
        version: 1,
        runtime: "openclaw",
        packs: [{ id: "dev-company" }],
        skills: [],
        workflow: {
          external_inputs: [],
          max_parallel: 2,
          stages: [
            { id: "build", owner: "tech-lead", inputs: ["plan.md"], optional_inputs: [], outputs: [], tools: [], validators: [], requires_human_approval: false },
          ],
        },
      },
      { projectDir: "/tmp/acme-web" },
    );
    expect(result.workflowWarnings).toHaveLength(1);
    expect(result.workflowWarnings[0]).toContain("plan.md");
  });

  it("throws when a workflow stage owner does not exist", async () => {
    await expect(
      resolveManifest(
        {
          version: 1,
          runtime: "openclaw",
          packs: [{ id: "dev-company" }],
          skills: [],
          workflow: {
            external_inputs: [],
            max_parallel: 2,
            stages: [
              { id: "plan", owner: "ghost-writer", inputs: [], optional_inputs: [], outputs: [], tools: [], validators: [], requires_human_approval: false },
            ],
          },
        },
        { projectDir: "/tmp/acme-web" },
      ),
    ).rejects.toThrow(/ghost-writer/);
  });

  it("validates owners inside foreach steps", async () => {
    await expect(
      resolveManifest(
        {
          version: 1,
          runtime: "openclaw",
          packs: [{ id: "dev-company" }],
          skills: [],
          workflow: {
            external_inputs: [],
            max_parallel: 2,
            stages: [
              {
                type: "foreach",
                id: "items",
                foreach: "outline.sections",
                item_name: "item",
                max_parallel: 2,
                steps: [
                  {
                    id: "draft",
                    owner: "ghost-writer",
                    inputs: [],
                    optional_inputs: [],
                    outputs: [],
                    tools: [],
                    validators: [],
                    requires_human_approval: false,
                  },
                ],
              },
            ],
          },
        },
        { projectDir: "/tmp/acme-web" },
      ),
    ).rejects.toThrow(/ghost-writer/);
  });

  it("leaves workflow undefined for manifests without one", async () => {
    const result = await resolveManifest(
      { version: 1, runtime: "openclaw", packs: [{ id: "dev-company" }], skills: [] },
      { projectDir: "/tmp/acme-web" },
    );
    expect(result.workflow).toBeUndefined();
    expect(result.workflowWarnings).toEqual([]);
  });
});
