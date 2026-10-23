import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamProxy } from "../src/proxy.js";

const TEST_MODEL: Model<"openai-completions"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "test-provider",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 4096,
	maxTokens: 1024,
};

const TEST_CONTEXT: Context = {
	systemPrompt: "You are helpful",
	messages: [],
	tools: [],
};

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeSseBody(events: object[]): ReadableStream<Uint8Array> {
	const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
	const bytes = new TextEncoder().encode(lines);
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

function stubFetch(events: object[]) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: true,
			body: makeSseBody(events),
		}),
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

async function collectStream(stream: ReturnType<typeof streamProxy>): Promise<{
	events: string[];
	result: AssistantMessage;
}> {
	const events: string[] = [];
	for await (const event of stream) {
		events.push(event.type);
	}
	const result = await stream.result();
	return { events, result };
}

describe("streamProxy", () => {
	it("resolves with done message on normal stream", async () => {
		stubFetch([
			{ type: "start" },
			{ type: "text_start", contentIndex: 0 },
			{ type: "text_delta", contentIndex: 0, delta: "Hello" },
			{ type: "text_end", contentIndex: 0 },
			{ type: "done", reason: "stop", usage: ZERO_USAGE },
		]);

		const stream = streamProxy(TEST_MODEL, TEST_CONTEXT, {
			authToken: "test-token",
			proxyUrl: "http://proxy",
		} as any);

		const { events, result } = await collectStream(stream);
		expect(events).toContain("done");
		expect(result.stopReason).toBe("stop");
	});

	it("returns error result when stream ends without terminal event", async () => {
		stubFetch([
			{ type: "start" },
			{ type: "text_start", contentIndex: 0 },
			{ type: "text_delta", contentIndex: 0, delta: "partial..." },
		]);

		const stream = streamProxy(TEST_MODEL, TEST_CONTEXT, {
			authToken: "test-token",
			proxyUrl: "http://proxy",
		} as any);

		const { events, result } = await collectStream(stream);

		expect(events).toContain("error");
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toMatch(/terminal event/);
	});

	it("returns error result on non-OK proxy response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 502,
				statusText: "Bad Gateway",
				json: () => Promise.resolve({ error: "upstream failed" }),
			}),
		);

		const stream = streamProxy(TEST_MODEL, TEST_CONTEXT, {
			authToken: "test-token",
			proxyUrl: "http://proxy",
		} as any);

		const result = await stream.result();

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toMatch(/upstream failed/);
	});

	it("returns aborted result when abort signal fires before fetch", async () => {
		const controller = new AbortController();

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(
				(_url: string, init: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
					}),
			),
		);

		const stream = streamProxy(TEST_MODEL, TEST_CONTEXT, {
			authToken: "test-token",
			proxyUrl: "http://proxy",
			signal: controller.signal,
		});

		controller.abort();

		const result = await stream.result();
		expect(result.stopReason).toBe("aborted");
	});
});
