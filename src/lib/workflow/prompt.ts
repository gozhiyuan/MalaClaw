import type { StandardStage } from "../schema.js";

export type PromptContext = {
  stage: StandardStage;
  unitKey: string;
  retryFeedback?: string[];
};

function section(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `${title}:\n${items.map((i) => `- ${i}`).join("\n")}\n\n`;
}

/** Render the file-backed stage contract handed to a WorkerRuntime.
 *  The worker is a black box; this text IS the interface. */
export function renderUnitPrompt(ctx: PromptContext): string {
  const { stage, unitKey, retryFeedback } = ctx;
  let prompt = `Stage: ${unitKey}\n`;
  if (stage.title) prompt += `Title: ${stage.title}\n`;
  prompt += `Owner: ${stage.owner}\n\n`;
  prompt += section("Inputs", stage.inputs);
  prompt += section("Optional inputs (use if present, never required)", stage.optional_inputs);
  prompt += section("Required outputs", stage.outputs);
  prompt += section("Allowed tools", stage.tools);
  prompt += section("Validators that will check your outputs", stage.validators);
  prompt +=
    "Rules:\n" +
    "- Only write files listed under Required outputs (plus reports/).\n" +
    "- If blocked, write reports/" + unitKey + "-blocker.md explaining why.\n" +
    "- Do not ask for permissions interactively; fail fast instead.\n";
  if (retryFeedback && retryFeedback.length > 0) {
    prompt +=
      "\nPrevious attempt failed. Fix these findings:\n" +
      retryFeedback.map((f) => `- ${f}`).join("\n") +
      "\n";
  }
  return prompt;
}
