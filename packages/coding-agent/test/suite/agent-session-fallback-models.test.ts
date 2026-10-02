import type { AssistantMessage, StreamFailureInfo } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, recordStreamFailure } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelSwitchEntry } from "../../src/core/session-manager.js";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

const FALLBACK_MODELS = [{ id: "faux-1" }, { id: "faux-2" }, { id: "faux-3" }];

function transientError(errorMessage = "overloaded_error"): AssistantMessage {
	return fauxAssistantMessage("", { stopReason: "error", errorMessage });
}

function structuredFailure(
	kind: StreamFailureInfo["kind"] | "permission",
	status?: number,
	errorMessage = `provider ${kind} failure`,
	providerErrorType?: string,
): AssistantMessage {
	return {
		...fauxAssistantMessage("", { stopReason: "error", errorMessage }),
		diagnostics: [
			{
				type: "provider_stream_failure",
				timestamp: Date.now(),
				details: {
					kind,
					...(status === undefined ? {} : { status }),
					...(providerErrorType === undefined ? {} : { providerErrorType }),
				},
			},
		],
	};
}

function recordedFailure(error: Error): AssistantMessage {
	const message = transientError(error.message);
	recordStreamFailure({ provider: "faux", id: "faux-1", api: "faux" }, message, error);
	return message;
}

function modelSwitches(harness: Harness): ModelSwitchEntry[] {
	return harness.sessionManager
		.getEntries()
		.filter((entry): entry is ModelSwitchEntry => entry.type === "model_switch");
}

describe("native model failover (fallbackModels)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("advances to the next fallback model once the retry policy is exhausted", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([transientError(), transientError(), transientError(), fauxAssistantMessage("recovered")]);

		await harness.session.prompt("test");

		expect(harness.session.model?.id).toBe("faux-2");
		expect(harness.faux.state.callCount).toBe(4);
		expect(getAssistantTexts(harness)).toContain("recovered");
	});

	it("skips an unavailable fallback and recovers on the next usable model", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		const unavailable = { ...harness.getModel("faux-2")!, provider: "missing-auth" };
		harness.session.setFallbackModels([unavailable, harness.getModel("faux-3")!]);

		harness.setResponses([
			transientError("429 rate limit"),
			transientError("429 rate limit"),
			fauxAssistantMessage("recovered"),
		]);

		await harness.session.prompt("test");

		expect(harness.session.model?.id).toBe("faux-3");
		expect(harness.faux.state.callCount).toBe(3);
		expect(getAssistantTexts(harness)).toContain("recovered");
		expect(modelSwitches(harness).map((entry) => entry.to)).toEqual(["faux/faux-3"]);
	});

	it("reports every unavailable fallback when the chain cannot be used", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		const unavailableTwo = { ...harness.getModel("faux-2")!, provider: "missing-auth-2" };
		const unavailableThree = { ...harness.getModel("faux-3")!, provider: "missing-auth-3" };
		harness.session.setFallbackModels([unavailableTwo, unavailableThree]);

		harness.setResponses([transientError("429 rate limit"), transientError("429 rate limit")]);

		await harness.session.prompt("test");

		const ends = harness.eventsOfType("auto_retry_end");
		const finalError = ends[ends.length - 1]?.finalError ?? "";
		expect(finalError).toContain("faux/faux-1 (rate_limit)");
		expect(finalError).toContain("missing-auth-2/faux-2 (unavailable)");
		expect(finalError).toContain("missing-auth-3/faux-3 (unavailable)");
		expect(modelSwitches(harness)).toEqual([]);
	});

	it("continues the same conversation across the switch", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([transientError(), transientError(), fauxAssistantMessage("after switch")]);

		await harness.session.prompt("remember this");

		const userTexts = harness.session.messages.filter((m) => m.role === "user");
		expect(userTexts.length).toBe(1);
		expect(harness.session.model?.id).toBe("faux-2");
		expect(getAssistantTexts(harness)).toContain("after switch");
	});

	it("records a structured model_switch entry in the session JSONL", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
			persistSession: true,
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([
			transientError("429 rate limit"),
			transientError("429 rate limit"),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("test");

		const switches = modelSwitches(harness);
		expect(switches).toHaveLength(1);
		expect(switches[0]).toMatchObject({
			type: "model_switch",
			from: "faux/faux-1",
			to: "faux/faux-2",
			attempt: 1,
		});
		expect(switches[0].reason).toContain("429 rate limit");
		expect(typeof switches[0].timestamp).toBe("string");
	});

	it("emits a model_switch session event", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([transientError(), transientError(), fauxAssistantMessage("ok")]);

		await harness.session.prompt("test");

		const events = harness.eventsOfType("model_switch");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ from: "faux/faux-1", to: "faux/faux-2" });
	});

	it("walks the whole chain when each model keeps failing", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!, harness.getModel("faux-3")!]);

		harness.setResponses([
			transientError(),
			transientError(),
			transientError(),
			transientError(),
			fauxAssistantMessage("third model works"),
		]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness).map((entry) => entry.to)).toEqual(["faux/faux-2", "faux/faux-3"]);
		expect(harness.session.model?.id).toBe("faux-3");
		expect(getAssistantTexts(harness)).toContain("third model works");
	});

	it.each([
		["fetch failed", () => transientError("fetch failed")],
		["terminated connection", () => transientError("terminated")],
		["other side closed", () => transientError("other side closed")],
		["socket hang up", () => transientError("socket hang up")],
		["ECONNREFUSED", () => transientError("connect ECONNREFUSED 127.0.0.1:443")],
		["upstream reset", () => transientError("upstream connect error or disconnect/reset before headers")],
		[
			"structured unknown ECONNRESET",
			() => recordedFailure(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })),
		],
		["structured unknown TypeError", () => recordedFailure(new TypeError("fetch failed"))],
		["raw HTTP 429", () => transientError("HTTP status 429: Too Many Requests")],
		["raw HTTP 503", () => transientError("response status 503: upstream reset")],
		["raw cooldown", () => transientError("provider cooldown active")],
		["structured rate limit", () => structuredFailure("rate_limit", 429)],
		["structured server error", () => structuredFailure("server_error", 503)],
	] as const)("fails over for %s", async (_name, makeFailure) => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);
		harness.setResponses([makeFailure(), makeFailure(), fauxAssistantMessage("recovered")]);

		await harness.session.prompt("test");

		expect(harness.session.model?.id).toBe("faux-2");
		expect(getAssistantTexts(harness)).toContain("recovered");
		expect(modelSwitches(harness)).toHaveLength(1);
	});

	it.each([
		["raw unterminated tool argument", () => transientError("unterminated tool argument")],
		[
			"structured unknown unterminated tool argument",
			() => structuredFailure("unknown", undefined, "unterminated tool argument"),
		],
	] as const)("does not fail over for %s", async (_name, makeFailure) => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);
		harness.setResponses([makeFailure(), makeFailure()]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness)).toEqual([]);
		expect(harness.session.model?.id).toBe("faux-1");
	});

	it.each([
		["payload max_tokens 512", "400 invalid_request: max_tokens 512 is invalid"],
		["payload 429", "400 invalid_request: field value 429 is invalid"],
		["transient words", "400 invalid_request: connection timeout while validating unavailable network input"],
	] as const)("does not fail over for an unstructured permanent 400 with %s", async (_name, errorMessage) => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);
		harness.setResponses([transientError(errorMessage), transientError(errorMessage)]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness)).toEqual([]);
		expect(harness.session.model?.id).toBe("faux-1");
	});

	it.each([
		["invalid_request", 400],
		["invalid_request", undefined],
		["auth", 401],
		["refusal", undefined],
		["safety", 503],
		["permission", 503],
		["unknown", 400],
	] as const)("structured permanent %s wins over transient wording", async (kind, status) => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);
		const failure = () => structuredFailure(kind, status, "connection timeout ECONNRESET 503 rate limit");
		harness.setResponses([failure(), failure()]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness)).toEqual([]);
		expect(harness.session.model?.id).toBe("faux-1");
	});

	it("a leading raw 400 wins over structured transport metadata", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);
		const failure = () =>
			structuredFailure(
				"unknown",
				undefined,
				"400 invalid_request: connection timeout while validating input",
				"ECONNRESET",
			);
		harness.setResponses([failure(), failure()]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness)).toEqual([]);
		expect(harness.session.model?.id).toBe("faux-1");
	});

	it("does not fail over for an unknown non-transport failure", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);
		const failure = () => structuredFailure("unknown", undefined, "invalid semantic response");
		harness.setResponses([failure(), failure()]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness)).toEqual([]);
		expect(harness.session.model?.id).toBe("faux-1");
	});

	it("does not switch on a 401 auth failure", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([
			structuredFailure("auth", 401),
			structuredFailure("auth", 401),
			structuredFailure("auth", 401),
		]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness)).toEqual([]);
		expect(harness.session.model?.id).toBe("faux-1");
	});

	it("does not switch on an invalid_request failure", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([
			structuredFailure("invalid_request"),
			structuredFailure("invalid_request"),
			structuredFailure("invalid_request"),
		]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness)).toEqual([]);
		expect(harness.session.model?.id).toBe("faux-1");
	});

	it("does not switch on an unstructured 400 invalid_request failure", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([
			transientError("400 invalid_request: malformed tool input"),
			transientError("400 invalid_request: malformed tool input"),
			fauxAssistantMessage("must not reach fallback"),
		]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness)).toEqual([]);
		expect(harness.session.model?.id).toBe("faux-1");
		expect(harness.faux.state.callCount).toBe(2);
	});

	it("keeps current behavior when no fallback chain is configured", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);

		harness.setResponses([transientError(), transientError()]);

		await harness.session.prompt("test");

		expect(modelSwitches(harness)).toEqual([]);
		expect(harness.session.model?.id).toBe("faux-1");
		expect(harness.eventsOfType("auto_retry_end").map((event) => event.success)).toEqual([false]);
	});

	it("reports every attempted model when the chain is exhausted", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([transientError(), transientError(), transientError(), transientError()]);

		await harness.session.prompt("test");

		const ends = harness.eventsOfType("auto_retry_end");
		const finalError = ends[ends.length - 1]?.finalError ?? "";
		expect(finalError).toContain("faux/faux-1");
		expect(finalError).toContain("faux/faux-2");
		expect(harness.eventsOfType("auto_retry_end").map((event) => event.success)).toContain(false);
	});

	it("does not reset goal budget counters across a switch", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
			initialGoal: { objective: "stay alive", tokenBudget: 1_000_000 },
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([
			{
				...fauxAssistantMessage("before switch"),
				usage: {
					input: 100,
					output: 50,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 150,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		]);
		await harness.session.prompt("first");
		const tokensBefore = harness.session.goalState.tokensUsed;
		expect(tokensBefore).toBeGreaterThan(0);

		harness.setResponses([transientError(), transientError(), fauxAssistantMessage("after switch")]);
		await harness.session.prompt("second");

		expect(harness.session.model?.id).toBe("faux-2");
		expect(harness.session.goalState.tokensUsed).toBeGreaterThanOrEqual(tokensBefore);
		expect(harness.session.goalState.objective).toBe("stay alive");
	});

	it("spawns RLM children on the active fallback model, not the configured default", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
			rlmDepth: 0,
			rlmMaxDepth: 2,
			subagentRuntimeHost: {
				createRlmSubagentRuntime: async () => {
					throw new Error("child runtime intentionally not started in this test");
				},
				deleteRlmSubagentRuntime: async () => {},
			},
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([transientError(), transientError(), fauxAssistantMessage("switched")]);
		await harness.session.prompt("test");
		expect(harness.session.model?.id).toBe("faux-2");

		await harness.session.runRlmChild("child task");

		const childUpdates = harness.eventsOfType("rlm_child_update");
		expect(childUpdates.length).toBeGreaterThan(0);
		expect(childUpdates[0].child.model).toBe("faux/faux-2");
	});

	it("does not persist an automatic failover as the user's default model", async () => {
		const harness = await createHarness({
			models: FALLBACK_MODELS,
			settings: {
				retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
				defaultProvider: "faux",
				defaultModel: "faux-1",
			},
		});
		harnesses.push(harness);
		harness.session.setFallbackModels([harness.getModel("faux-2")!]);

		harness.setResponses([transientError(), transientError(), fauxAssistantMessage("recovered")]);

		await harness.session.prompt("test");

		// The session runs on the fallback, but a transient outage must not
		// silently repoint the configured default for every future session.
		expect(harness.session.model?.id).toBe("faux-2");
		expect(harness.settingsManager.getDefaultModel()).toBe("faux-1");
		expect(harness.settingsManager.getDefaultProvider()).toBe("faux");
	});
});
