import { afterEach, describe, expect, it } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.js";
import { getModel, getModels } from "../src/models.js";

const originalFireworksApiKey = process.env.FIREWORKS_API_KEY;

afterEach(() => {
	if (originalFireworksApiKey === undefined) {
		delete process.env.FIREWORKS_API_KEY;
	} else {
		process.env.FIREWORKS_API_KEY = originalFireworksApiKey;
	}
});

describe("Fireworks models", () => {
	it("registers the default Kimi K2.6 model via Anthropic-compatible Messages API", () => {
		const model = getModel("fireworks", "accounts/fireworks/models/kimi-k2p6");

		expect(model).toBeDefined();
		expect(model.api).toBe("anthropic-messages");
		expect(model.provider).toBe("fireworks");
		expect(model.baseUrl).toBe("https://api.fireworks.ai/inference");
		expect(model.reasoning).toBe(true);
		expect(model.input).toEqual(["text", "image"]);
		expect(model.contextWindow).toBe(262000);
		expect(model.maxTokens).toBe(262000);
		expect(model.cost).toEqual({
			input: 0.95,
			output: 4,
			cacheRead: 0.16,
			cacheWrite: 0,
		});
	});

	// models.dev swaps router ids between catalog revisions (kimi-k2p6-turbo →
	// kimi-k3-fast), so resolve the current router model instead of pinning one.
	// api and baseUrl are generator invariants for every fireworks entry; input
	// mirrors live modality data, so only its text floor is asserted.
	const routerModel = getModels("fireworks")
		.filter((model) => model.id.startsWith("accounts/fireworks/routers/"))
		.sort((a, b) => b.id.localeCompare(a.id))[0];

	it.skipIf(!routerModel)("registers Fire Pass router models", () => {
		expect(routerModel).toBeDefined();
		expect(routerModel.api).toBe("anthropic-messages");
		expect(routerModel.baseUrl).toBe("https://api.fireworks.ai/inference");
		expect(routerModel.input).toContain("text");
	});

	it("resolves FIREWORKS_API_KEY from the environment", () => {
		process.env.FIREWORKS_API_KEY = "test-fireworks-key";

		expect(findEnvKeys("fireworks")).toEqual(["FIREWORKS_API_KEY"]);
		expect(getEnvApiKey("fireworks")).toBe("test-fireworks-key");
	});
});
