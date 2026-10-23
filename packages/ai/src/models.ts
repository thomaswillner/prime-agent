import { MODELS } from "./models.generated.js";
import type { Api, KnownProvider, Model, ModelThinkingLevel, Usage } from "./types.js";

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();

// Initialize registry from MODELS on module load
for (const [provider, models] of Object.entries(MODELS)) {
	const providerModels = new Map<string, Model<Api>>();
	for (const [id, model] of Object.entries(models)) {
		providerModels.set(id, model as Model<Api>);
	}
	modelRegistry.set(provider, providerModels);
}

/**
 * The catalog entry for a provider, and the ids it carries, narrowed to the providers
 * MODELS actually holds.
 *
 * `src/models.generated.ts` is a committed artifact refreshed by an explicit
 * `npm run generate-models`, so its provider keys change only when someone regenerates
 * and commits it. A provider whose upstream source listed no models at that moment has
 * no key at all, which is why KnownProvider cannot be assumed to be a subset of
 * `keyof typeof MODELS`.
 *
 * Both helpers are deliberately non-distributive (`[TProvider] extends [...]`). Two
 * unsound alternatives were tried and rejected:
 *   - `keyof CatalogModels<P>` where the absent branch is `never`: `keyof never` widens
 *     to `string | number | symbol`, so any string was accepted for an absent provider.
 *   - a distributive conditional: for `P = "openai" | "anthropic"` it unions the ids of
 *     both, so an openai id type-checked against a value that was anthropic at runtime.
 * Either one lets getModel() type-check, return undefined through its cast, and crash
 * the caller. Keeping the conditional non-distributive preserves the provider/model
 * correlation: a union of providers yields only the ids common to all of them, and a
 * union containing an absent provider yields never.
 */
type CatalogModels<TProvider extends KnownProvider> = [TProvider] extends [keyof typeof MODELS]
	? (typeof MODELS)[TProvider & keyof typeof MODELS]
	: never;

type CatalogModelId<TProvider extends KnownProvider> = [TProvider] extends [keyof typeof MODELS]
	? keyof (typeof MODELS)[TProvider & keyof typeof MODELS]
	: never;

type ModelApi<
	TProvider extends KnownProvider,
	TModelId extends CatalogModelId<TProvider>,
> = CatalogModels<TProvider>[TModelId & keyof CatalogModels<TProvider>] extends { api: infer TApi }
	? TApi extends Api
		? TApi
		: never
	: never;

export function getModel<TProvider extends KnownProvider, TModelId extends CatalogModelId<TProvider>>(
	provider: TProvider,
	modelId: TModelId,
): Model<ModelApi<TProvider, TModelId>> {
	const providerModels = modelRegistry.get(provider);
	return providerModels?.get(modelId as string) as Model<ModelApi<TProvider, TModelId>>;
}

export function getProviders(): KnownProvider[] {
	return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getModels<TProvider extends KnownProvider>(
	provider: TProvider,
): Model<ModelApi<TProvider, CatalogModelId<TProvider>>>[] {
	const models = modelRegistry.get(provider);
	return models ? (Array.from(models.values()) as Model<ModelApi<TProvider, CatalogModelId<TProvider>>>[]) : [];
}

export function supportsFastMode<TApi extends Api>(model: Model<TApi>): boolean {
	return (
		model.provider === "openai-codex" &&
		model.api === "openai-codex-responses" &&
		(model.id === "gpt-5.4" || model.id === "gpt-5.5" || model.id === "gpt-5.6" || model.id.startsWith("gpt-5.6-"))
	);
}

export interface CostOverrides {
	cacheWrite?: number;
}

export function calculateCost<TApi extends Api>(
	model: Model<TApi>,
	usage: Usage,
	overrides?: CostOverrides,
): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = ((overrides?.cacheWrite ?? model.cost.cacheWrite) / 1000000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function getSupportedThinkingLevels<TApi extends Api>(model: Model<TApi>): ModelThinkingLevel[] {
	if (!model.reasoning) return ["off"];

	return EXTENDED_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	});
}

export function clampThinkingLevel<TApi extends Api>(
	model: Model<TApi>,
	level: ModelThinkingLevel,
): ModelThinkingLevel {
	const availableLevels = getSupportedThinkingLevels(model);
	if (availableLevels.includes(level)) return level;

	const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
	if (requestedIndex === -1) return availableLevels[0] ?? "off";

	for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	for (let i = requestedIndex - 1; i >= 0; i--) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	return availableLevels[0] ?? "off";
}

/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
