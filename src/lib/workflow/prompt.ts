export type PromptUnit = {
  title?: string;
  owner: string;
  inputs: string[];
  optional_inputs: string[];
  outputs: string[];
  tools: string[];
  allowed_tools?: string[];
  validators: string[];
  validator_commands?: Array<{ cmd: string; args: string[] }>;
};

export type PromptContext = {
  stage: PromptUnit;
  unitKey: string;
  retryFeedback?: string[];
  /** Skill documents (path + content) injected into the contract. */
  skillDocs?: Array<{ path: string; content: string }>;
  /** Hard structural requirements (e.g. foreach fan-out id arrays). */
  contractNotes?: string[];
};

function section(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `${title}:\n${items.map((i) => `- ${i}`).join("\n")}\n\n`;
}

/** Render the file-backed stage contract handed to a WorkerRuntime.
 *  The worker is a black box; this text IS the interface. */
export function renderUnitPrompt(ctx: PromptContext): string {
  const { stage, unitKey, retryFeedback, skillDocs, contractNotes } = ctx;
  let prompt = `Stage: ${unitKey}\n`;
  if (stage.title) prompt += `Title: ${stage.title}\n`;
  prompt += `Owner: ${stage.owner}\n\n`;
  prompt += section("Inputs", stage.inputs);
  prompt += section("Optional inputs (use if present, never required)", stage.optional_inputs);
  prompt += section("Required outputs", stage.outputs);
  prompt += section("Tools you may reference", stage.tools);
  prompt += section("Harness tools granted for this stage", stage.allowed_tools ?? []);
  prompt += section("Structured output contract (MUST be satisfied exactly)", contractNotes ?? []);
  prompt += section("Validators that will check your outputs", stage.validators);
  prompt += section(
    "External validator commands that will run after built-ins",
    (stage.validator_commands ?? []).map((command) => [command.cmd, ...command.args].join(" ")),
  );
  prompt +=
    "Rules:\n" +
    "- Only write files listed under Required outputs (plus reports/).\n" +
    "- If blocked, write reports/" + unitKey + "-blocker.md explaining why.\n" +
    "- Do not ask for permissions interactively; fail fast instead.\n";
  for (const skill of skillDocs ?? []) {
    prompt +=
      `\nSkill: ${skill.path}\n` +
      "Follow this skill document while producing the outputs:\n" +
      "---\n" + skill.content.trim() + "\n---\n";
  }
  if (retryFeedback && retryFeedback.length > 0) {
    prompt +=
      "\nPrevious attempt failed. Fix these findings:\n" +
      retryFeedback.map((f) => `- ${f}`).join("\n") +
      "\n";
  }
  return prompt;
}
