# CLI Proxy Crash Fix — Complete Technical Record

**Branch:** `claude/hermes-cli-proxy-crash-qi48rs`
**PR:** https://github.com/thomaswillner/prime-agent/pull/1
**Files changed:**
- `packages/agent/src/proxy.ts` — two bug fixes
- `packages/agent/test/proxy.test.ts` — new regression tests (created)

---

## 1. System Architecture (read this first)

The proxy path is used when the app routes LLM calls through an intermediate server instead of calling providers directly. The flow is:

```
User / Agent loop
    │
    ▼
streamProxy()                         ← packages/agent/src/proxy.ts
    │  HTTP POST /api/stream
    ▼
Proxy server (external, e.g. Hermes)
    │  SSE stream: data: {...}\n\n
    ▼
streamProxy() reads SSE lines
    │  calls processProxyEvent() per event
    ▼
ProxyMessageEventStream               ← subclass of EventStream<T,R>
    │  stream.push(event)
    ▼
streamAssistantResponse()             ← packages/agent/src/agent-loop.ts
    │  for await (const event of stream) { ... }
    │  await response.result()        ← THIS IS THE HANG POINT
    ▼
Agent loop continues with final AssistantMessage
```

---

## 2. The EventStream Class — How It Works

**File:** `packages/ai/src/utils/event-stream.ts`

`EventStream<T, R>` is the base class for all streaming LLM responses. It has two jobs:
1. Act as an async iterable — yield events as they arrive.
2. Hold a `finalResultPromise` that resolves to the final `AssistantMessage` result.

```typescript
export class EventStream<T, R = T> implements AsyncIterable<T> {
    private finalResultPromise: Promise<R>;
    private resolveFinalResult!: (result: R) => void;

    constructor(
        private isComplete: (event: T) => boolean,
        private extractResult: (event: T) => R,
    ) {
        this.finalResultPromise = new Promise((resolve) => {
            this.resolveFinalResult = resolve;
        });
    }

    push(event: T): void {
        if (this.done) return;

        if (this.isComplete(event)) {
            this.done = true;
            this.resolveFinalResult(this.extractResult(event));  // ← resolves the promise
        }
        // deliver to consumer...
    }

    end(result?: R): void {
        this.done = true;
        if (result !== undefined) {
            this.resolveFinalResult(result);  // ← ONLY resolves if result is passed
        }
        // drain waiting consumers...
    }

    result(): Promise<R> {
        return this.finalResultPromise;  // ← callers await this
    }
}
```

**Critical rule:** `finalResultPromise` only ever resolves in two ways:
1. `stream.push(terminalEvent)` — when `isComplete(event)` returns true.
2. `stream.end(result)` — only if `result !== undefined`.

If neither happens, `finalResultPromise` is **permanently pending**.

---

## 3. ProxyMessageEventStream — What Counts as Terminal

`ProxyMessageEventStream` (defined in `proxy.ts`) is a subclass of `EventStream`. Its constructor defines what "complete" means:

```typescript
class ProxyMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
    constructor() {
        super(
            (event) => event.type === "done" || event.type === "error",  // terminal when done or error
            (event) => {
                if (event.type === "done") return event.message;
                if (event.type === "error") return event.error;
                throw new Error("Unexpected event type");
            },
        );
    }
}
```

So `finalResultPromise` only resolves when an event with `type === "done"` or `type === "error"` is pushed via `stream.push()`.

---

## 4. How the Agent Loop Consumes the Stream

**File:** `packages/agent/src/agent-loop.ts`, function `streamAssistantResponse`

```typescript
// iterates all events from the stream
for await (const event of response) {
    // ... handle each event ...
    case "done":
    case "error": {
        let finalMessage = getTerminalMessage(event);
        try {
            finalMessage = await maybePromiseWithAbort(response.result(), signal);  // ← await here
        } catch (error) { ... }
    }
}

// also awaited AFTER the loop exits
const finalMessage = await maybePromiseWithAbort(response.result(), signal);  // ← await here too
```

There are **two separate `await response.result()` calls** — one inside the loop on the terminal event, and one after the loop exits. If `finalResultPromise` never resolves, either of these blocks forever.

---

## 5. The Bug — What Caused the Hang

**File:** `packages/agent/src/proxy.ts` (before fix)

The SSE reading loop:

```typescript
while (true) {
    const { done, value } = await reader.read();
    if (done) break;   // ← loop exits when server closes connection

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
        if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data) {
                const proxyEvent = JSON.parse(data) as ProxyAssistantMessageEvent;
                const event = processProxyEvent(proxyEvent, partial);
                if (event) {
                    stream.push(event);   // push each event
                }
            }
        }
    }
}

// AFTER the loop:
stream.end();   // ← called with NO argument
```

**The bug:** If the proxy server closed the HTTP connection before sending a `done` or `error` SSE event (e.g., a crash, network drop, or incomplete response), the loop exited naturally at `if (done) break`. Then `stream.end()` was called with no argument.

Per the `EventStream.end()` contract: no `result` argument → `finalResultPromise` is **never resolved**.

The agent loop's `await response.result()` then **blocks indefinitely** — appearing as a CLI freeze or hang.

---

## 6. The Fix — Exactly What Changed

### Fix 1: Track terminal events, synthesize one if missing

**Location:** `packages/agent/src/proxy.ts`, inside `streamProxy()`, inside the async IIFE.

**Before (no tracking):**
```typescript
for (const line of lines) {
    if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data) {
            const proxyEvent = JSON.parse(data) as ProxyAssistantMessageEvent;
            const event = processProxyEvent(proxyEvent, partial);
            if (event) {
                stream.push(event);
                // nothing tracked
            }
        }
    }
}
// ...
// After while loop:
stream.end();  // BUG: no argument, promise hangs if no terminal event was pushed
```

**After (with tracking):**
```typescript
let receivedTerminalEvent = false;   // ← NEW: declared before the while loop

// Inside the for (const line of lines) loop:
for (const line of lines) {
    if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data) {
            const proxyEvent = JSON.parse(data) as ProxyAssistantMessageEvent;
            const event = processProxyEvent(proxyEvent, partial);
            if (event) {
                stream.push(event);
                if (event.type === "done" || event.type === "error") {
                    receivedTerminalEvent = true;   // ← NEW: track terminal events
                }
            }
        }
    }
}

// After the while loop exits:
if (options.signal?.aborted) {
    throw new Error("Request aborted by user");
}

if (!receivedTerminalEvent) {
    // ← NEW: synthesize a terminal error event so finalResultPromise always resolves
    partial.stopReason = "error";
    partial.errorMessage = "Proxy stream ended without a terminal event";
    stream.push({
        type: "error",
        reason: "error",
        error: partial,
    });
}
stream.end();   // now safe: finalResultPromise was already resolved by the push above
```

**Why this works:** `stream.push({ type: "error", ... })` triggers `isComplete(event)` → true → calls `this.resolveFinalResult(event.error)` inside `EventStream.push()`. By the time `stream.end()` is called, `finalResultPromise` is already resolved. The agent loop's `await response.result()` unblocks immediately with a structured `AssistantMessage` (stopReason: `"error"`, errorMessage: `"Proxy stream ended without a terminal event"`).

**Normal path is unchanged:** When the server sends a proper `done` or `error` event, `receivedTerminalEvent` is set to `true`, the `if (!receivedTerminalEvent)` block is skipped, and `stream.end()` is called as before. Tokens flow through exactly as they always did.

---

### Fix 2: `toolcall_end` consistency — throw instead of silent undefined

**Location:** `packages/agent/src/proxy.ts`, inside `processProxyEvent()`, `"toolcall_end"` case.

**Before:**
```typescript
case "toolcall_end": {
    const content = partial.content[proxyEvent.contentIndex];
    if (content?.type === "toolCall") {
        delete (content as any).partialJson;
        return {
            type: "toolcall_end",
            contentIndex: proxyEvent.contentIndex,
            toolCall: content,
            partial,
        };
    }
    return undefined;   // ← silent failure, inconsistent with every other case
}
```

**After:**
```typescript
case "toolcall_end": {
    const content = partial.content[proxyEvent.contentIndex];
    if (content?.type === "toolCall") {
        delete (content as any).partialJson;
        return {
            type: "toolcall_end",
            contentIndex: proxyEvent.contentIndex,
            toolCall: content,
            partial,
        };
    }
    throw new Error("Received toolcall_end for non-toolCall content");   // ← now throws, consistent
}
```

Every other mismatched-content case (`text_delta`, `text_end`, `thinking_delta`, `thinking_end`, `toolcall_delta`) already throws. `toolcall_end` was the only silent case — a discrepancy that could mask corrupted stream state.

---

## 7. Tests Added

**File:** `packages/agent/test/proxy.test.ts` (new file)

Four tests, all using `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(...))` to mock the global `fetch` before calling `streamProxy`.

```typescript
// Helper: build a ReadableStream from SSE events
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

// Helper: stub global fetch to return SSE body
function stubFetch(events: object[]) {
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
            ok: true,
            body: makeSseBody(events),
        }),
    );
}
```

### Test 1 — Normal stream resolves with done message
```typescript
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
```

### Test 2 — Stream ends without terminal event returns error (the regression test)
```typescript
it("returns error result when stream ends without terminal event", async () => {
    stubFetch([
        { type: "start" },
        { type: "text_start", contentIndex: 0 },
        { type: "text_delta", contentIndex: 0, delta: "partial..." },
        // NO done or error event — connection dropped
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
```

### Test 3 — Non-OK HTTP response returns error
```typescript
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
```

### Test 4 — Abort signal fires before fetch resolves
```typescript
it("returns aborted result when abort signal fires before fetch", async () => {
    const controller = new AbortController();

    vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () =>
                        reject(new DOMException("Aborted", "AbortError"))
                    );
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
```

All 4 tests pass. Full `packages/agent` suite: **73/73 passing**.

---

## 8. What Was NOT Changed

- **Normal SSE token flow**: unchanged. Events flow `start → text_start → text_delta (tokens) → text_end → done` exactly as before.
- **Abort handling**: the `abortHandler` / signal wiring was already correct.
- **`processProxyEvent()`**: all cases unchanged except `toolcall_end` (Fix 2 above).
- **`EventStream` base class**: not modified.
- **Agent loop**: not modified.
- **`packages/ai` tests**: 23 pre-existing failures (require AWS Bedrock credentials / multi-provider API keys) — unrelated to this fix.

---

## 9. Commit History on Branch

```
6434cee  chore: update package-lock.json after npm install
6bf7ad2  fix(agent): resolve CLI proxy hang when SSE stream ends without terminal event
```

Both commits are on `claude/hermes-cli-proxy-crash-qi48rs`, pushed to origin.
