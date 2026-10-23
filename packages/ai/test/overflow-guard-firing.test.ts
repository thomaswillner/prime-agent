import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.js";
import { isContextOverflow, usesSilentOverflowDetection } from "../src/utils/overflow.js";
import { formatStreamFailureMessage } from "../src/utils/stream-failure.js";

/**
 * Negative controls for the context-overflow guard. overflow.test.ts covers the answer
 * for inputs handed to the guard directly; a guard that never runs, or whose input was
 * rewritten upstream, is indistinguishable from "checked, no overflow" by that test.
 *
 * Each block asserts both directions, so stubbing isContextOverflow() to a constant in
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
		// The same message reads as "no overflow" with no window, so callers must not
		// infer "checked" from a false return.
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

	it("files an explicit quota exhaustion as non-overflow", () => {
		// "token limit exceeded" is an ambiguous signal, so an actual quota failure that
		// uses that wording must be vetoed...
		expect(isContextOverflow(errorMessage("Token limit exceeded: monthly quota exhausted"), 200_000)).toBe(false);
		// ...while an unambiguous overflow that merely mentions a quota is still detected.
		expect(
			isContextOverflow(errorMessage("prompt is too long: 213462 tokens > 200000 maximum (quota 200/min)"), 200_000),
		).toBe(true);
		expect(
			isContextOverflow(
				errorMessage("This endpoint's maximum context length is 131072 tokens; quota 200/min"),
				200_000,
			),
		).toBe(true);
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
	// Providers assign `output.errorMessage = formatStreamFailureMessage(error)`, so the
	// guard reads the formatted text, not the original.
	it.each(PROVIDER_OVERFLOW_ERRORS)("passes an unclassifiable overflow through verbatim: %s", (text) => {
		const raw = new Error(text);
		expect(isContextOverflow(errorMessage(raw.message), 200_000)).toBe(true);
		expect(isContextOverflow(errorMessage(formatStreamFailureMessage(raw)), 200_000)).toBe(true);
	});

	// A bare Error classifies as `unknown`, which returns the message verbatim, so the
	// case above never reaches the preservation branch. Providers throw a named SDK error
	// carrying a status and no nested body — Google's ApiError is the documented one —
	// and that is the shape the branch has to handle.
	it.each(PROVIDER_OVERFLOW_ERRORS)("survives formatting as a named SDK error: %s", (text) => {
		const formatted = formatStreamFailureMessage(Object.assign(new Error(text), { name: "ApiError", status: 400 }));
		expect(formatted).toContain("Provider rejected the request");
		expect(isContextOverflow(errorMessage(formatted), 200_000)).toBe(true);
	});

	it("keeps an overflow marker that a long gateway prefix pushes past the head excerpt", () => {
		const prefixed = `gateway-route=${"a".repeat(230)}; upstream=vertex; prompt is too long: 213462 tokens > 200000 maximum`;
		const formatted = formatStreamFailureMessage(
			Object.assign(new Error(prefixed), { name: "ApiError", status: 400 }),
		);
		expect(formatted).toContain("prompt is too long");
		expect(isContextOverflow(errorMessage(formatted), 200_000)).toBe(true);
	});

	it("keeps the non-overflow veto effective behind the classified prefix", () => {
		// The veto patterns are anchored, and formatting prepends a summary, so a `^`-only
		// anchor stops vetoing and the ambiguous signal in the text wins.
		const raw = "Service unavailable: context_length_exceeded";
		expect(isContextOverflow(errorMessage(raw), 200_000)).toBe(false);
		const formatted = formatStreamFailureMessage(Object.assign(new Error(raw), { status: 503 }));
		expect(formatted).toContain("Service unavailable");
		expect(isContextOverflow(errorMessage(formatted), 200_000)).toBe(false);
	});

	it("keeps the relaxed Cerebras anchor 400/413-only", () => {
		// The anchor had to accept a detail prefix to survive formatting; the digits, not
		// the anchor, are what keep a 429 out.
		expect(
			isContextOverflow(
				errorMessage("Provider rejected the request (BadRequestError, 400): 400 status code (no body)"),
				200_000,
			),
		).toBe(true);
		expect(
			isContextOverflow(errorMessage("Provider rate limit exceeded (429): 429 status code (no body)"), 200_000),
		).toBe(false);
	});

	it.each(PROVIDER_OVERFLOW_ERRORS)("survives formatting when a string code names the error: %s", (text) => {
		const formatted = formatStreamFailureMessage(
			Object.assign(new Error(text), { code: "invalid_argument", status: 400 }),
		);
		expect(isContextOverflow(errorMessage(formatted), 200_000)).toBe(true);
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

	it("keeps the preserved evidence to an excerpt rather than the whole payload", () => {
		// Head and tail are both kept, so the control is that the bulk between them goes.
		const payload = `<html><title>502 Bad Gateway</title><body>${"x".repeat(2000)}BULK${"y".repeat(2000)}</body></html>`;
		const formatted = formatStreamFailureMessage(Object.assign(new Error(payload), { status: 502 }));
		expect(formatted).toContain("Provider server error (502)");
		expect(formatted.length).toBeLessThan(500);
		expect(formatted).not.toContain("BULK");
	});

	it("preserves the evidence when only an HTTP status classified the failure", () => {
		// A status fixes the kind but carries no overflow evidence, so requiring
		// `status === undefined` before preserving the message would hide a real overflow
		// that a gateway returned under a 429.
		const formatted = formatStreamFailureMessage(
			Object.assign(new Error("prompt is too long: 213462 tokens > 200000 maximum"), { status: 429 }),
		);
		expect(formatted).toContain("Provider rate limit exceeded (429)");
		expect(isContextOverflow(errorMessage(formatted), 200_000)).toBe(true);
	});
});
