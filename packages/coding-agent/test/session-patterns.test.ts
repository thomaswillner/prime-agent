import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatSessionPatternReport,
	parseSessionPatternsArgs,
	runSessionPatterns,
} from "../src/cli/session-patterns-command.js";
import {
	analyzeSessionFile,
	analyzeSessionPatterns,
	buildSessionPatternReport,
	collectSessionFacts,
	isPromptSurfacePath,
	type SessionFacts,
	type SessionPatternReport,
} from "../src/core/session-patterns.js";

let sessionDir: string;
let entryCounter = 0;

beforeEach(() => {
	sessionDir = mkdtempSync(join(tmpdir(), "session-patterns-"));
	entryCounter = 0;
});

afterEach(() => {
	rmSync(sessionDir, { recursive: true, force: true });
});

function nextId(): string {
	entryCounter++;
	return `entry${String(entryCounter).padStart(4, "0")}`;
}

function timestamp(): string {
	return new Date(Date.UTC(2026, 0, 1, 0, entryCounter)).toISOString();
}

function header(id: string, cwd = "/work/project"): Record<string, unknown> {
	return { type: "session", version: 3, id, timestamp: timestamp(), cwd };
}

function userEntry(text: string): Record<string, unknown> {
	return {
		type: "message",
		id: nextId(),
		parentId: null,
		timestamp: timestamp(),
		message: { role: "user", content: text, timestamp: Date.UTC(2026, 0, 1) },
	};
}

function assistantEntry(
	toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [],
): Record<string, unknown> {
	return {
		type: "message",
		id: nextId(),
		parentId: null,
		timestamp: timestamp(),
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "working" },
				...toolCalls.map((call, index) => ({
					type: "toolCall",
					id: `call${index}`,
					name: call.name,
					arguments: call.arguments,
				})),
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test-model",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
			stopReason: "stop",
			timestamp: Date.UTC(2026, 0, 1),
		},
	};
}

function compactionEntry(tokensBefore = 50000): Record<string, unknown> {
	return {
		type: "compaction",
		id: nextId(),
		parentId: null,
		timestamp: timestamp(),
		summary: "earlier work",
		firstKeptEntryId: "entry0001",
		tokensBefore,
	};
}

function writeSession(fileName: string, entries: Array<Record<string, unknown>>): string {
	const path = join(sessionDir, fileName);
	writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	return path;
}

async function sessionFacts(path: string): Promise<SessionFacts> {
	const analyzed = await analyzeSessionFile(path);
	if (!analyzed) {
		throw new Error(`not a session file: ${path}`);
	}
	return analyzed;
}

function patternById(report: Awaited<ReturnType<typeof analyzeSessionPatterns>>, id: string) {
	const pattern = report.patterns.find((candidate) => candidate.id === id);
	if (!pattern) {
		throw new Error(`missing pattern ${id}`);
	}
	return pattern;
}

describe("isPromptSurfacePath", () => {
	it("matches instruction files, skills, and prompt templates", () => {
		expect(isPromptSurfacePath("/work/AGENTS.md")).toBe(true);
		expect(isPromptSurfacePath("/work/CLAUDE.md")).toBe(true);
		expect(isPromptSurfacePath("/work/skills/review/SKILL.md")).toBe(true);
		expect(isPromptSurfacePath("/work/prompts/triage.md")).toBe(true);
		expect(isPromptSurfacePath("/work/src/review.prompt.md")).toBe(true);
		expect(isPromptSurfacePath("C:\\work\\prompts\\triage.md")).toBe(true);
		expect(isPromptSurfacePath("/work/src/system-prompt.ts")).toBe(true);
	});

	it("ignores ordinary project files", () => {
		expect(isPromptSurfacePath("/work/README.md")).toBe(false);
		expect(isPromptSurfacePath("/work/src/index.ts")).toBe(false);
		expect(isPromptSurfacePath("/work/docs/skills.md")).toBe(false);
	});
});

describe("analyzeSessionFile", () => {
	it("marks a compaction the agent worked through as mid-task", async () => {
		const path = writeSession("mid-task.jsonl", [
			header("mid-task"),
			userEntry("do the thing"),
			assistantEntry([{ name: "bash", arguments: { command: "ls" } }]),
			compactionEntry(),
			assistantEntry([{ name: "bash", arguments: { command: "ls" } }]),
		]);

		const facts = await sessionFacts(path);

		expect(facts.compactions).toHaveLength(1);
		expect(facts.compactions[0]!.midTask).toBe(true);
		expect(facts.compactions[0]!.tokensBefore).toBe(50000);
	});

	it("does not mark a compaction as mid-task when the next turn is the user", async () => {
		const path = writeSession("turn-boundary.jsonl", [
			header("turn-boundary"),
			userEntry("do the thing"),
			assistantEntry(),
			compactionEntry(),
			userEntry("next task"),
			assistantEntry(),
		]);

		const facts = await sessionFacts(path);

		expect(facts.compactions).toHaveLength(1);
		expect(facts.compactions[0]!.midTask).toBe(false);
		expect(facts.userMessageCount).toBe(2);
	});

	it("records prompt surface edits and whether anything ran afterwards", async () => {
		const unverified = writeSession("unverified.jsonl", [
			header("unverified"),
			userEntry("tune the prompt"),
			assistantEntry([{ name: "bash", arguments: { command: "cat AGENTS.md" } }]),
			assistantEntry([{ name: "edit", arguments: { path: "/work/AGENTS.md", edits: [] } }]),
		]);
		const verified = writeSession("verified.jsonl", [
			header("verified"),
			userEntry("tune the prompt"),
			assistantEntry([{ name: "edit", arguments: { path: "/work/AGENTS.md", edits: [] } }]),
			assistantEntry([{ name: "ipython", arguments: { code: "run_eval()" } }]),
		]);

		const unverifiedFacts = await sessionFacts(unverified);
		const verifiedFacts = await sessionFacts(verified);

		expect(unverifiedFacts.promptSurfaceEdits).toEqual(["/work/AGENTS.md"]);
		expect(unverifiedFacts.ranCommandAfterLastPromptEdit).toBe(false);
		expect(verifiedFacts.promptSurfaceEdits).toEqual(["/work/AGENTS.md"]);
		expect(verifiedFacts.ranCommandAfterLastPromptEdit).toBe(true);
	});

	it("orders tool calls within a single assistant message", async () => {
		const path = writeSession("same-message.jsonl", [
			header("same-message"),
			userEntry("tune the prompt"),
			assistantEntry([
				{ name: "edit", arguments: { path: "/work/AGENTS.md", edits: [] } },
				{ name: "bash", arguments: { command: "npm test" } },
			]),
		]);

		const facts = await sessionFacts(path);

		expect(facts.ranCommandAfterLastPromptEdit).toBe(true);
	});

	it("ignores edits to ordinary project files", async () => {
		const path = writeSession("project-edit.jsonl", [
			header("project-edit"),
			userEntry("fix the bug"),
			assistantEntry([{ name: "edit", arguments: { path: "/work/src/index.ts", edits: [] } }]),
		]);

		const facts = await sessionFacts(path);

		expect(facts.promptSurfaceEdits).toEqual([]);
		expect(facts.ranCommandAfterLastPromptEdit).toBe(false);
	});

	it("skips files whose first line is not a session header", async () => {
		const path = writeSession("not-a-session.jsonl", [userEntry("hello")]);

		expect(await analyzeSessionFile(path)).toBeUndefined();
	});

	it("skips malformed lines instead of failing", async () => {
		const path = join(sessionDir, "malformed.jsonl");
		writeFileSync(path, `${JSON.stringify(header("malformed"))}\nnot json\n${JSON.stringify(compactionEntry())}\n`);

		const facts = await sessionFacts(path);

		expect(facts.compactions).toHaveLength(1);
	});
});

describe("buildSessionPatternReport", () => {
	it("counts matching sessions and links examples", async () => {
		writeSession("pressure-a.jsonl", [
			header("pressure-a"),
			userEntry("big task"),
			compactionEntry(),
			assistantEntry(),
			compactionEntry(),
			assistantEntry(),
		]);
		writeSession("pressure-b.jsonl", [
			header("pressure-b"),
			userEntry("big task"),
			assistantEntry(),
			compactionEntry(),
			userEntry("next"),
			assistantEntry(),
		]);
		writeSession("clean.jsonl", [header("clean"), userEntry("small task"), assistantEntry()]);

		const report = await analyzeSessionPatterns({ sessionDir });
		const pressure = patternById(report, "context-pressure");

		expect(report.sessionsAnalyzed).toBe(3);
		expect(pressure.sessionCount).toBe(1);
		expect(pressure.examples).toHaveLength(1);
		expect(pressure.examples[0]!.id).toBe("pressure-a");
		expect(pressure.examples[0]!.evidence).toBe("2 compactions (2 mid-task)");
		expect(pressure.kind).toBe("rule-based");
	});

	it("flags a single mid-task compaction", async () => {
		writeSession("single.jsonl", [
			header("single"),
			userEntry("big task"),
			assistantEntry(),
			compactionEntry(),
			assistantEntry(),
		]);

		const report = await analyzeSessionPatterns({ sessionDir });

		expect(patternById(report, "context-pressure").sessionCount).toBe(1);
		expect(patternById(report, "context-pressure").examples[0]!.evidence).toBe("1 compaction (1 mid-task)");
	});

	it("reports zero-match rules so a reported count can be contradicted", async () => {
		writeSession("clean.jsonl", [header("clean"), userEntry("small task"), assistantEntry()]);

		const report = await analyzeSessionPatterns({ sessionDir });

		expect(report.patterns).toHaveLength(2);
		for (const pattern of report.patterns) {
			expect(pattern.sessionCount).toBe(0);
			expect(pattern.examples).toEqual([]);
		}
	});

	it("ranks patterns by session count and honors the example limit", async () => {
		for (const name of ["a", "b"]) {
			writeSession(`prompt-${name}.jsonl`, [
				header(`prompt-${name}`),
				userEntry("tune the prompt"),
				assistantEntry([{ name: "edit", arguments: { path: "/work/AGENTS.md", edits: [] } }]),
			]);
		}
		writeSession("pressure.jsonl", [
			header("pressure"),
			userEntry("big task"),
			assistantEntry(),
			compactionEntry(),
			assistantEntry(),
		]);

		const facts = await collectSessionFacts(sessionDir);
		const report = buildSessionPatternReport(sessionDir, facts, { exampleLimit: 1 });

		expect(report.patterns[0]!.id).toBe("prompt-edits-unverified");
		expect(report.patterns[0]!.sessionCount).toBe(2);
		expect(report.patterns[0]!.examples).toHaveLength(1);
		expect(report.patterns[1]!.id).toBe("context-pressure");
		expect(report.patterns[1]!.sessionCount).toBe(1);
	});

	it("returns an empty report for a missing session directory", async () => {
		const report = await analyzeSessionPatterns({ sessionDir: join(sessionDir, "missing") });

		expect(report.sessionsAnalyzed).toBe(0);
		expect(report.patterns.every((pattern) => pattern.sessionCount === 0)).toBe(true);
	});
});

describe("session patterns command", () => {
	it("parses options", () => {
		const parsed = parseSessionPatternsArgs(["--json", "--examples", "5", "--session-dir", "/tmp/sessions"]);

		expect(parsed).toEqual({
			ok: true,
			options: { json: true, exampleLimit: 5, sessionDir: "/tmp/sessions" },
		});
	});

	it("defaults to three examples and text output", () => {
		const parsed = parseSessionPatternsArgs([]);

		expect(parsed).toEqual({ ok: true, options: { json: false, exampleLimit: 3 } });
	});

	it("rejects bad options", () => {
		expect(parseSessionPatternsArgs(["--nope"])).toEqual({
			ok: false,
			error: "Unknown option for session patterns: --nope",
		});
		expect(parseSessionPatternsArgs(["--examples"])).toEqual({ ok: false, error: "Missing value for --examples." });
		expect(parseSessionPatternsArgs(["--examples", "-1"])).toEqual({
			ok: false,
			error: '--examples requires a non-negative integer, got "-1".',
		});
		expect(parseSessionPatternsArgs(["--examples", "two"])).toEqual({
			ok: false,
			error: '--examples requires a non-negative integer, got "two".',
		});
		expect(parseSessionPatternsArgs(["--session-dir"])).toEqual({
			ok: false,
			error: "Missing value for --session-dir.",
		});
	});

	it("renders the report in the reported format", async () => {
		writeSession("pressure.jsonl", [
			header("pressure"),
			userEntry("big task"),
			assistantEntry(),
			compactionEntry(),
			assistantEntry(),
		]);

		const report = await analyzeSessionPatterns({ sessionDir });
		const text = formatSessionPatternReport(report);

		expect(text).toContain("Analyzed 1 session in ");
		expect(text).toContain("Rule-based");
		expect(text).toContain("Split or summarize work before context pressure and mid-task compactions accumulate.");
		expect(text).toContain("1 of 1 sessions have this deterministic pattern.");
		expect(text).toContain("Rule: Two or more compactions");
		expect(text).toContain("Examples:");
		expect(text).toContain("pressure  1 compaction (1 mid-task)  /work/project");
		expect(text).toContain("--resume pressure");
	});

	it("reports an empty session store", () => {
		const text = formatSessionPatternReport({ sessionDir: "/tmp/none", sessionsAnalyzed: 0, patterns: [] });

		expect(text).toBe("No sessions found in /tmp/none");
	});

	it("prints text by default and JSON on request", async () => {
		writeSession("pressure.jsonl", [
			header("pressure"),
			userEntry("big task"),
			assistantEntry(),
			compactionEntry(),
			assistantEntry(),
		]);
		const logged: string[] = [];
		const log = vi.spyOn(console, "log").mockImplementation((line: string) => {
			logged.push(line);
		});

		try {
			await runSessionPatterns({ json: false, exampleLimit: 3, sessionDir });
			await runSessionPatterns({ json: true, exampleLimit: 3, sessionDir });
		} finally {
			log.mockRestore();
		}

		expect(logged[0]).toContain("1 of 1 sessions have this deterministic pattern.");
		const parsed = JSON.parse(logged[1]!) as SessionPatternReport;
		expect(parsed.sessionsAnalyzed).toBe(1);
		expect(parsed.patterns.map((pattern) => pattern.id).sort()).toEqual([
			"context-pressure",
			"prompt-edits-unverified",
		]);
	});
});
