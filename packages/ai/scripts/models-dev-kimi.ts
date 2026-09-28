import type { Model } from "../src/types.js";

export interface ModelsDevModel {
	id: string;
	name: string;
	tool_call?: boolean;
	reasoning?: boolean;
	limit?: {
		context?: number;
		output?: number;
	};
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	modalities?: {
		input?: string[];
		output?: string[];
	};
	provider?: {
		npm?: string;
	};
}

interface ModelsDevProvider {
	models?: Record<string, ModelsDevModel>;
}

export type ModelsDevCatalog = Record<string, ModelsDevProvider | undefined>;

const KIMI_STATIC_HEADERS = {
	"User-Agent": "KimiCLI/1.5",
} as const;

export function getKimiCodingModels(data: ModelsDevCatalog): Model<"anthropic-messages">[] {
	// Legacy key fallback: models.dev renamed this provider without notice (#19); tolerate a revert or older snapshot.
	const kimiProvider = Object.prototype.hasOwnProperty.call(data, "kimi-code-plan-cn")
		? data["kimi-code-plan-cn"]
		: data["kimi-for-coding"];
	const kimiModels = kimiProvider?.models;
	if (!kimiModels) return [];

	const models: Model<"anthropic-messages">[] = [];
	const hasCanonicalModel = Object.prototype.hasOwnProperty.call(kimiModels, "kimi-for-coding");
	const kimiAliases = new Set(["k2p5", "k2p6"]);

	for (const [modelId, model] of Object.entries(kimiModels)) {
		if (model.tool_call !== true) continue;
		// models.dev may expose versioned aliases (e.g. k2p5/k2p6).
		// Normalize aliases to the canonical model id and drop duplicates when canonical exists.
		if (kimiAliases.has(modelId) && hasCanonicalModel) continue;

		const normalizedId = kimiAliases.has(modelId) ? "kimi-for-coding" : modelId;
		const normalizedName = kimiAliases.has(modelId) ? "Kimi For Coding" : model.name || normalizedId;

		models.push({
			id: normalizedId,
			name: normalizedName,
			api: "anthropic-messages",
			provider: "kimi-coding",
			// Kimi For Coding's Anthropic-compatible API - SDK appends /v1/messages
			baseUrl: "https://api.kimi.com/coding",
			headers: { ...KIMI_STATIC_HEADERS },
			reasoning: model.reasoning === true,
			input: model.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
			cost: {
				input: model.cost?.input || 0,
				output: model.cost?.output || 0,
				cacheRead: model.cost?.cache_read || 0,
				cacheWrite: model.cost?.cache_write || 0,
			},
			// Kimi's sources disagree for kimi-for-coding: models.dev and kimi.com list 1048576, the official
			// kimi-code config lists 262144. Cap at main's 262144 until verified; a lower upstream limit wins.
			contextWindow:
				normalizedId === "kimi-for-coding"
					? Math.min(model.limit?.context || 262144, 262144)
					: model.limit?.context || 4096,
			maxTokens: model.limit?.output || 4096,
		});
	}

	return models;
}
