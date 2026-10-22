import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api, Model } from "../src/types.js";

let byProvider: Record<string, Model<Api>[]> = {};

vi.mock("../src/models.js", () => ({
	getModels: (provider: string) => byProvider[provider] ?? [],
}));

import { getCloudflareGatewayWorkersAiTestModel, getKimiCodingTestModel } from "./kimi-test-model.js";

function createModel(id: string, api: Api, provider: string, input: ("text" | "image")[] = ["text"]): Model<Api> {
	return {
		id,
		name: id,
		api,
		provider,
		baseUrl: "https://example.invalid",
		reasoning: false,
		input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 4096,
	} as Model<Api>;
}

const kimi = (id: string, input: ("text" | "image")[] = ["text"]) =>
	createModel(id, "anthropic-messages", "kimi-coding", input);
const gateway = (id: string) => createModel(id, "openai-completions", "cloudflare-ai-gateway");

describe("getKimiCodingTestModel", () => {
	beforeEach(() => {
		byProvider = {};
	});

	it("prefers the earliest id in the preference list", () => {
		byProvider["kimi-coding"] = [kimi("k3"), kimi("kimi-for-coding"), kimi("k2p7")];

		expect(getKimiCodingTestModel()?.id).toBe("kimi-for-coding");
	});

	it("falls back to the first listed model when none match the preference list", () => {
		byProvider["kimi-coding"] = [kimi("some-unlisted-model"), kimi("another-one")];

		expect(getKimiCodingTestModel()?.id).toBe("some-unlisted-model");
	});

	it("restricts to image-capable models when asked", () => {
		byProvider["kimi-coding"] = [kimi("k3"), kimi("kimi-for-coding-vision", ["text", "image"])];

		expect(getKimiCodingTestModel({ image: true })?.id).toBe("kimi-for-coding-vision");
	});

	// These two are the reason the helper no longer throws. vitest executes a describe
	// body during collection even when skipIf marks it skipped, so throwing here failed
	// the whole file rather than skipping the suite — which is what happened when a
	// catalog revision carried no kimi-coding entry.
	it("returns undefined when the catalog lists no kimi-coding model", () => {
		expect(getKimiCodingTestModel()).toBeUndefined();
		expect(getKimiCodingTestModel({ image: true })).toBeUndefined();
	});

	it("returns undefined when no listed model accepts images", () => {
		byProvider["kimi-coding"] = [kimi("k3"), kimi("kimi-for-coding")];

		expect(getKimiCodingTestModel({ image: true })).toBeUndefined();
		expect(getKimiCodingTestModel()?.id).toBe("kimi-for-coding");
	});
});

describe("getCloudflareGatewayWorkersAiTestModel", () => {
	beforeEach(() => {
		byProvider = {};
	});

	it("prefers a Kimi workers-ai route over other workers-ai models", () => {
		byProvider["cloudflare-ai-gateway"] = [
			gateway("workers-ai/@cf/meta/llama-4-scout"),
			gateway("workers-ai/@cf/moonshotai/kimi-k2.6"),
			gateway("openai/gpt-5.1"),
		];

		expect(getCloudflareGatewayWorkersAiTestModel()?.id).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
	});

	it("falls back to any workers-ai model when no Kimi route is listed", () => {
		byProvider["cloudflare-ai-gateway"] = [gateway("workers-ai/@cf/meta/llama-4-scout"), gateway("openai/gpt-5.1")];

		expect(getCloudflareGatewayWorkersAiTestModel()?.id).toBe("workers-ai/@cf/meta/llama-4-scout");
	});

	it("returns undefined when the gateway lists no workers-ai model", () => {
		byProvider["cloudflare-ai-gateway"] = [gateway("openai/gpt-5.1")];

		expect(getCloudflareGatewayWorkersAiTestModel()).toBeUndefined();
	});

	it("returns undefined when the gateway is absent from the catalog", () => {
		expect(getCloudflareGatewayWorkersAiTestModel()).toBeUndefined();
	});
});
