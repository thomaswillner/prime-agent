import { getModels } from "../src/models.js";
import type { Model } from "../src/types.js";

const COPILOT_CLAUDE_PREFERENCE = ["claude-sonnet-4.6", "claude-sonnet-5"];
const COPILOT_CODEX_PREFERENCE = ["gpt-5.3-codex"];

function getPreferredModel<TApi extends "anthropic-messages" | "openai-responses">(
	api: TApi,
	preferredIds: string[],
): Model<TApi> {
	const models = getModels("github-copilot").filter((model) => model.api === api) as Model<TApi>[];
	for (const id of preferredIds) {
		const model = models.find((candidate) => candidate.id === id);
		if (model) return model;
	}
	const model = models[0];
	if (!model) throw new Error(`No GitHub Copilot ${api} model is available`);
	return model;
}

export function getGitHubCopilotClaudeTestModel(): Model<"anthropic-messages"> {
	return getPreferredModel("anthropic-messages", COPILOT_CLAUDE_PREFERENCE);
}

export function getGitHubCopilotNonAdaptiveClaudeTestModel(): Model<"anthropic-messages"> {
	const model = getModels("github-copilot").find(
		(candidate): candidate is Model<"anthropic-messages"> =>
			candidate.api === "anthropic-messages" && candidate.reasoning && candidate.id.includes("haiku"),
	);
	if (!model) throw new Error("No non-adaptive GitHub Copilot Claude model is available");
	return model;
}

export function getGitHubCopilotCodexTestModel(): Model<"openai-responses"> {
	return getPreferredModel("openai-responses", COPILOT_CODEX_PREFERENCE);
}
