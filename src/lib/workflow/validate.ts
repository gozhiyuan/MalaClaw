import type { WorkflowDef, WorkflowStage } from "../schema.js";
import { parseStopCondition } from "./stop-condition.js";

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
  modelTier?: string;
  enabled: boolean;
  skippable: boolean;
  disabledReason?: string;
};

/** Flatten a stage into ordered work units. Foreach steps keep their declared
 *  order, so within an item pipeline earlier steps' outputs count as produced
 *  for later steps' inputs. */
function validateStopConfig(
  id: string,
  maxRounds: number | undefined,
  stopWhen: string | undefined,
  onExhaustion: "succeed" | "fail" | undefined,
  errors: string[],
  hasStagnation = false,
): void {
  if (onExhaustion === "fail" && !stopWhen) {
    errors.push(`Stage "${id}": on_exhaustion: fail requires stop_when`);
  }
  if (hasStagnation && !stopWhen) {
    errors.push(`Stage "${id}": stop_on_stagnation requires stop_when (the metric it watches)`);
  }
  if (!stopWhen) return;
  if (!maxRounds) {
    errors.push(
      `Stage "${id}": stop_when requires max_rounds (an unbounded loop is not allowed)`,
    );
  }
  if (!parseStopCondition(stopWhen)) {
    errors.push(
      `Stage "${id}": stop_when "${stopWhen}" is not a valid condition (<metric> <op> <number>)`,
    );
  }
}

function toWorkUnits(stage: WorkflowStage, prefix?: string): WorkUnit[] {
  const labelPrefix = prefix ? `${prefix}.` : "";
  if ("stages" in stage) {
    if (!stage.enabled) {
      return stage.stages.flatMap((child) => toWorkUnits({ ...child, enabled: false } as WorkflowStage, `${labelPrefix}${stage.id}`));
    }
    return stage.stages.flatMap((child) => toWorkUnits(child, `${labelPrefix}${stage.id}`));
  }
  if ("steps" in stage) {
    return stage.steps.map((step) => ({
      label: `${labelPrefix}${stage.id}.${step.id}`,
      owner: step.owner,
      inputs: step.inputs,
      outputs: step.outputs,
      modelTier: step.model_tier,
      enabled: stage.enabled && step.enabled,
      skippable: stage.skippable || step.skippable,
      disabledReason: !stage.enabled ? stage.disabled_reason : step.disabled_reason,
    }));
  }
  if (stage.type === "action_dispatch") {
    return [{
      label: `${labelPrefix}${stage.id}`,
      owner: stage.owner,
      inputs: [stage.plan_path],
      outputs: stage.outputs,
      enabled: stage.enabled,
      skippable: stage.skippable,
      disabledReason: stage.disabled_reason,
    }];
  }
  return [{
    label: `${labelPrefix}${stage.id}`,
    owner: stage.owner,
    inputs: stage.inputs,
    outputs: stage.outputs,
    modelTier: stage.model_tier,
    enabled: stage.enabled,
    skippable: stage.skippable,
    disabledReason: stage.disabled_reason,
  }];
}

function validateToggle(label: string, unit: WorkUnit, errors: string[]): void {
  if (!unit.enabled && !unit.skippable) {
    errors.push(`Stage "${label}": enabled: false requires skippable: true`);
  }
  if (!unit.enabled && !unit.disabledReason) {
    errors.push(`Stage "${label}": enabled: false requires disabled_reason`);
  }
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
  const disabledOutputs: string[] = [];

  for (const stage of workflow.stages) {
    if (!("steps" in stage) && stage.type !== "action_dispatch") {
      validateStopConfig(stage.id, stage.max_rounds, stage.stop_when, stage.on_exhaustion, errors, "stop_on_stagnation" in stage && stage.stop_on_stagnation !== undefined);
      if ("stages" in stage) {
        for (const child of stage.stages) {
          if (!("steps" in child) && child.type !== "action_dispatch") {
            validateStopConfig(`${stage.id}.${child.id}`, child.max_rounds, child.stop_when, child.on_exhaustion, errors);
          }
        }
      }
    }
    for (const unit of toWorkUnits(stage)) {
      validateToggle(unit.label, unit, errors);
      if (!availableOwnerIds.has(unit.owner)) {
        errors.push(
          `Stage "${unit.label}": owner "${unit.owner}" is not an agent in any selected team or attached agent`,
        );
      }
      if (unit.modelTier && !(workflow.model_tiers && unit.modelTier in workflow.model_tiers)) {
        errors.push(
          `Stage "${unit.label}": model_tier "${unit.modelTier}" is not defined in workflow.model_tiers`,
        );
      }
      if (!unit.enabled) {
        disabledOutputs.push(...unit.outputs);
        continue;
      }
      for (const input of unit.inputs) {
        if (!producedOutputs.some((out) => matchesArtifact(out, input))) {
          if (disabledOutputs.some((out) => matchesArtifact(out, input))) {
            errors.push(
              `Stage "${unit.label}": required input "${input}" is produced only by an earlier disabled stage; make it optional or declare it in external_inputs`,
            );
          } else {
            warnings.push(
              `Stage "${unit.label}": input "${input}" is not produced by any earlier stage (fine if it is user-provided)`,
            );
          }
        }
      }
      producedOutputs.push(...unit.outputs);
    }
  }

  return { errors, warnings };
}
