import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.js";
import { isContextOverflow, usesSilentOverflowDetection } from "../src/utils/overflow.js";
import { formatStreamFailureMessage } from "../src/utils/stream-failure.js";

/**
 * Negative controls for the context-overflow guard.
 *
 * overflow.test.ts checks that isContextOverflow() returns the right answer for
 * inputs handed to it directly. That cannot catch a guard that never gets to run,
 * or one whose input was rewritten upstream - both look identical to "checked, no
 * overflow" from the outside. These tests exercise the three ways this guard can
 * report a plausible pass without evaluating anything:
 *
 *   1. it never dispatches (no context window, so the usage-based cases are skipped)
 *   2. a real signal is discarded as throttling/quota
 *   3. an incidental word elsewhere in the text is classified instead of the signal
 *
 * A false negative is not neutral. AgentSession._isRetryableError() treats "not an
 * overflow" as "retryable", so a missed overflow stops compaction and re-sends the
 * same oversized request until the retry budget is gone.
 *
 * Each block asserts both directions - the guard fires when it should AND stays
 * quiet when it should not - so stubbing isContextOverflow() to a constant in
 * either direction turns this file red.
 */

function errorMessage(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: 0,
	};
}

function silentOverflow(inputTokens: number): AssistantMessage {
	return {
		...errorMessage(""),
		stopReason: "stop",
		errorMessage: undefined,
		usage: {
			input: inputTokens,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: inputTokens + 10,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

/** Overflow errors that also carry a word pointing at some other failure kind. */
const COLLIDING_OVERFLOW_ERRORS = [
	// z.ai returns overflow and rate-limit text for the same condition; gateways
	// append quota metadata to the provider body.
	"prompt is too long: 213462 tokens > 200000 maximum (rate limit: 100/min)",
	"This endpoint's maximum context length is 131072 tokens. However, you requested about 537812 tokens (rate limit applies)",
	// "overloaded" and "unauthorized" are matched by classifyStreamFailure() as
	// substrings, ahead of anything that looks at the actual overflow phrase.
	"prompt is too long: 213462 tokens > 200000 maximum; server overloaded, retry later",
	"The input token count (1196265) exceeds the maximum number of tokens allowed (1048575) [unauthorized retry]",
];

/** Real overflow errors, one per documented provider dialect. */
const PROVIDER_OVERFLOW_ERRORS = [
	"prompt is too long: 213462 tokens > 200000 maximum",
	"Your input exceeds the context window of this model",
	"The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
	"This model's maximum prompt length is 131072 but the request contains 537812 tokens",
	"Please reduce the length of the messages or completion",
	"the request exceeds the available context size, try increasing it",
	"tokens to keep from the initial prompt is greater than the context length",
	"invalid params, context window exceeds limit",
	"Your request exceeded model token limit: 131072 (requested: 537812)",
	"400 (no body)",
];

/** Failures that must never be read as overflow, whatever else they mention. */
const NON_OVERFLOW_ERRORS = [
	"500 `model runner crashed unexpectedly`",
	"Rate limit exceeded, please retry after 30 seconds.",
	"Too many requests. Please slow down.",
	"Throttling error: Too many tokens, please wait before trying again.",
	"Service unavailable: The service is temporarily unavailable.",
	"fetch failed",
];

describe("overflow guard: shape 1 - the guard must be able to dispatch", () => {
	it("reports whether the usage-based cases can run at all", () => {
		expect(usesSilentOverflowDetection(200_000)).toBe(true);
		// Both call sites in AgentSession read `this.model?.contextWindow ?? 0`, and
		// `model` is `Model<any> | undefined`. When it is undefined the guard is handed
		// 0 and silently skips cases 2 and 3.
		expect(usesSilentOverflowDetection(0)).toBe(false);
		expect(usesSilentOverflowDetection(undefined)).toBe(false);
	});

	it("detects a silent overflow when wired, and is a no-op when not", () => {
		const message = silentOverflow(500_000);
		expect(isContextOverflow(message, 200_000)).toBe(true);
		// Documents the trap: the same message reads as "no overflow" with no window.
		// usesSilentOverflowDetection() is the only way to tell this apart from a real
		// negative, so callers must not infer "checked" from a false return.
		expect(isContextOverflow(message, 0)).toBe(false);
		expect(isContextOverflow(message, undefined)).toBe(false);
	});

	it("still evaluates error-text overflow without a context window", () => {
		// Case 1 does not depend on the window, so a missing window must not take the
		// whole guard offline.
		expect(isContextOverflow(errorMessage("prompt is too long: 213462 tokens > 200000 maximum"), 0)).toBe(true);
	});
});

describe("overflow guard: shape 2 - a real signal must not be discarded as quota", () => {
	it.each(COLLIDING_OVERFLOW_ERRORS)("detects overflow despite colliding text: %s", (text) => {
		expect(isContextOverflow(errorMessage(text), 200_000)).toBe(true);
	});

	it.each(NON_OVERFLOW_ERRORS)("does not read a non-overflow failure as overflow: %s", (text) => {
		expect(isContextOverflow(errorMessage(text), 200_000)).toBe(false);
	});

	it("keeps the throttling veto for generic signals that a quota error can produce", () => {
		// "Too many tokens" is what Bedrock says for HTTP 429, so it stays vetoed...
		expect(isContextOverflow(errorMessage("Throttling error: Too many tokens, please wait again."), 200_000)).toBe(
			false,
		);
		// ...but the same generic phrase counts when nothing marks it as throttling.
		expect(isContextOverflow(errorMessage("Request rejected: too many tokens in prompt"), 200_000)).toBe(true);
	});
});

describe("overflow guard: shape 3 - the signal must survive provider formatting", () => {
	it.each(PROVIDER_OVERFLOW_ERRORS)("survives formatStreamFailureMessage: %s", (text) => {
		const raw = new Error(text);
		// Providers assign `output.errorMessage = formatStreamFailureMessage(error)`
		// before this guard ever sees the message, so the guard reads the formatted
		// text, not the original.
		expect(isContextOverflow(errorMessage(raw.message), 200_000)).toBe(true);
		expect(isContextOverflow(errorMessage(formatStreamFailureMessage(raw)), 200_000)).toBe(true);
	});

	it.each(COLLIDING_OVERFLOW_ERRORS)("survives formatting when another kind matches first: %s", (text) => {
		expect(isContextOverflow(errorMessage(formatStreamFailureMessage(new Error(text))), 200_000)).toBe(true);
	});

	it("keeps the classified summary and the evidence it classified from", () => {
		const formatted = formatStreamFailureMessage(
			new Error("prompt is too long: 213462 tokens > 200000 maximum; server overloaded, retry later"),
		);
		expect(formatted).toContain("Provider overloaded");
		expect(formatted).toContain("prompt is too long");
	});

	it("still condenses errors that carry a structured provider message", () => {
		// A body message is the provider's own summary, so the raw payload stays out.
		const sdkError = Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error"}}'), {
			status: 401,
			error: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
		});
		expect(formatStreamFailureMessage(sdkError)).toBe(
			"Provider authentication failed (authentication_error, 401): invalid x-api-key",
		);
	});

	it.each(NON_OVERFLOW_ERRORS)("formatting does not invent an overflow signal: %s", (text) => {
		expect(isContextOverflow(errorMessage(formatStreamFailureMessage(new Error(text))), 200_000)).toBe(false);
	});
});
