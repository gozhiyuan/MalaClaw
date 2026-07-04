import type { WorkflowDef, WorkflowStage } from "../schema.js";

export type WorkflowValidationResult = {
  errors: string[];
  warnings: string[];
};

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert an artifact pattern to a regex. Both `*` globs and `{{item.id}}`
 *  templates match arbitrary path content. */
function patternToRegex(pattern: string): RegExp {
  const wildcarded = pattern.replace(/\{\{[^}]+\}\}/g, "*");
  return new RegExp("^" + wildcarded.split("*").map(escapeRegex).join(".*") + "$");
}

/** True when a produced artifact path satisfies a declared input path.
 *  Either side may contain `*` globs or `{{...}}` templates. */
export function matchesArtifact(produced: string, input: string): boolean {
  if (produced === input) return true;
  return patternToRegex(produced).test(input) || patternToRegex(input).test(produced);
}

type WorkUnit = {
  label: string;
  owner: string;
  inputs: string[];
  outputs: string[];
};

/** Flatten a stage into ordered work units. Foreach steps keep their declared
 *  order, so within an item pipeline earlier steps' outputs count as produced
 *  for later steps' inputs. */
function toWorkUnits(stage: WorkflowStage): WorkUnit[] {
  if ("steps" in stage) {
    return stage.steps.map((step) => ({
      label: `${stage.id}.${step.id}`,
      owner: step.owner,
      inputs: step.inputs,
      outputs: step.outputs,
    }));
  }
  return [{ label: stage.id, owner: stage.owner, inputs: stage.inputs, outputs: stage.outputs }];
}

/** Semantic checks that need resolved context (schema-shape checks live in Zod).
 *  Errors block install; warnings are informational. */
export function validateWorkflowSemantics(
  workflow: WorkflowDef,
  availableOwnerIds: Set<string>,
): WorkflowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Seed with user/environment-provided artifacts so they never trigger warnings.
  const producedOutputs: string[] = [...workflow.external_inputs];

  for (const stage of workflow.stages) {
    for (const unit of toWorkUnits(stage)) {
      if (!availableOwnerIds.has(unit.owner)) {
        errors.push(
          `Stage "${unit.label}": owner "${unit.owner}" is not an agent in any selected team or attached agent`,
        );
      }
      for (const input of unit.inputs) {
        if (!producedOutputs.some((out) => matchesArtifact(out, input))) {
          warnings.push(
            `Stage "${unit.label}": input "${input}" is not produced by any earlier stage (fine if it is user-provided)`,
          );
        }
      }
      producedOutputs.push(...unit.outputs);
    }
  }

  return { errors, warnings };
}
