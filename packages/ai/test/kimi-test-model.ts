import { getModels } from "../src/models.js";
import type { Model } from "../src/types.js";

const KIMI_TEST_MODEL_PREFERENCE = ["kimi-k2-thinking", "kimi-for-coding", "k2p7", "k3", "kimi-for-coding-highspeed"];

// models.dev drops and renames Workers AI ids between catalog revisions
// (workers-ai/@cf/moonshotai/kimi-k2.6 vanished from the cloudflare-ai-gateway
// listing), so resolve the current /compat model at runtime rather than pinning
// an id the next revision invalidates. Kimi ids are preferred to keep the
// exercised model comparable across revisions; any workers-ai /compat model
// keeps the transport tests alive when no Kimi is listed. Callers must guard
// with skipIf: the result is undefined when the catalog lists no workers-ai
// model at all.
export function getCloudflareGatewayWorkersAiTestModel(): Model<"openai-completions"> {
	const models = getModels("cloudflare-ai-gateway").filter(
		(model): model is Model<"openai-completions"> =>
			model.api === "openai-completions" && model.id.startsWith("workers-ai/"),
	);
	const kimis = models.filter((model) => model.id.includes("/moonshotai/kimi-"));
	const pool = kimis.length > 0 ? kimis : models;
	return pool.sort((a, b) => b.id.localeCompare(a.id))[0];
}

export function getKimiCodingTestModel(options: { image?: boolean } = {}): Model<"anthropic-messages"> {
	const models = getModels("kimi-coding") as Model<"anthropic-messages">[];
	const eligible = options.image ? models.filter((model) => model.input.includes("image")) : models;
	for (const id of KIMI_TEST_MODEL_PREFERENCE) {
		const model = eligible.find((candidate) => candidate.id === id);
		if (model) return model;
	}
	const model = eligible[0];
	if (!model) {
		throw new Error(`No ${options.image ? "image-capable " : ""}Kimi Coding model is available`);
	}
	return model;
}
