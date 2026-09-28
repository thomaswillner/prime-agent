import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { getKimiCodingModels, type ModelsDevCatalog } from "../scripts/models-dev-kimi.js";

const fixture = JSON.parse(
	readFileSync(join(import.meta.dirname, "fixtures/models-dev-kimi-code-plan-cn.json"), "utf8"),
) as ModelsDevCatalog;

describe("models.dev Kimi ingestion", () => {
	it("maps the current China coding-plan catalog to the existing internal provider", () => {
		const models = getKimiCodingModels(fixture);

		expect(models.map((model) => model.provider)).toEqual([
			"kimi-coding",
			"kimi-coding",
			"kimi-coding",
			"kimi-coding",
		]);
		expect(models.map((model) => model.id)).toEqual([
			"kimi-for-coding-highspeed",
			"kimi-for-coding",
			"k3-256k",
			"k3",
		]);
		expect(models.map((model) => model.baseUrl)).toEqual([
			"https://api.kimi.com/coding",
			"https://api.kimi.com/coding",
			"https://api.kimi.com/coding",
			"https://api.kimi.com/coding",
		]);
		expect(fixture["kimi-code-plan-cn"]?.models?.["kimi-for-coding"]?.limit?.context).toBe(1048576);
		expect(models.map((model) => model.contextWindow)).toEqual([262144, 1048576, 262144, 1048576]);
	});

	it("uses the legacy provider only when the current China key is absent", () => {
		const currentProvider = fixture["kimi-code-plan-cn"];
		const legacyFixture: ModelsDevCatalog = {
			"kimi-for-coding": currentProvider,
		};

		expect(getKimiCodingModels(legacyFixture).map((model) => model.id)).toEqual([
			"kimi-for-coding-highspeed",
			"kimi-for-coding",
			"k3-256k",
			"k3",
		]);
	});

	it("prefers the current China key when the legacy key is also present", () => {
		const currentProvider = fixture["kimi-code-plan-cn"];
		const precedenceFixture: ModelsDevCatalog = {
			"kimi-code-plan-cn": currentProvider,
			"kimi-for-coding": {
				models: {
					"legacy-only": {
						id: "legacy-only",
						name: "Legacy Only",
						tool_call: true,
					},
				},
			},
		};

		expect(getKimiCodingModels(precedenceFixture).map((model) => model.id)).toEqual([
			"kimi-for-coding-highspeed",
			"kimi-for-coding",
			"k3-256k",
			"k3",
		]);
	});

	it("does not use legacy data when the current China key exists without models", () => {
		const currentProvider = fixture["kimi-code-plan-cn"];
		const noFallbackFixture: ModelsDevCatalog = {
			"kimi-code-plan-cn": {},
			"kimi-for-coding": currentProvider,
		};

		expect(getKimiCodingModels(noFallbackFixture)).toEqual([]);
	});

	it("does not map the global coding-plan catalog", () => {
		const globalFixture: ModelsDevCatalog = {
			"kimi-code-plan-global": fixture["kimi-code-plan-cn"],
		};

		expect(getKimiCodingModels(globalFixture)).toEqual([]);
	});
});
