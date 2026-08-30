/**
 * Deterministic, rule-based patterns over saved sessions.
 *
 * Every rule is a pure function of facts extracted from a session file, so the
 * same session store always produces the same counts. This exists to check
 * reported session analytics against the local session store.
 */

import { readdir, stat } from "fs/promises";
import { basename, join } from "path";
import { getSessionsDir } from "../config.js";
import { readLinesAsBuffers } from "../utils/file-lines.js";
import type { FileEntry, SessionHeader } from "./session-manager.js";

export const DEFAULT_SESSION_PATTERN_EXAMPLES = 3;

/** Tool names that execute something, used to decide whether a change was exercised. */
const COMMAND_TOOL_NAMES = new Set(["bash", "ipython"]);

const PROMPT_SURFACE_BASENAMES = new Set(["agents.md", "claude.md", "skill.md", "prompt.md"]);

const PROMPT_SURFACE_DIRECTORIES = new Set(["prompts", "skills"]);

export interface SessionCompactionFact {
	entryId: string;
	timestamp: string;
	tokensBefore: number;
	/** The agent kept working on the same user turn after this compaction. */
	midTask: boolean;
}

/** Everything the rules are allowed to look at, extracted in a single pass over a session file. */
export interface SessionFacts {
	path: string;
	id: string;
	cwd: string;
	name: string | undefined;
	modifiedMs: number;
	userMessageCount: number;
	compactions: SessionCompactionFact[];
	/** Distinct prompt surface files edited through the edit tool, in first-edit order. */
	promptSurfaceEdits: string[];
	/** A bash or ipython call happened after the last prompt surface edit. */
	ranCommandAfterLastPromptEdit: boolean;
}

export interface SessionPatternRule {
	id: string;
	/** Verbatim remediation text shown with the pattern. */
	recommendation: string;
	/** What the detector actually checks, so a count can be audited. */
	definition: string;
	/** Returns evidence when the session matches, undefined otherwise. */
	evaluate(facts: SessionFacts): string | undefined;
}

export interface SessionPatternExample {
	id: string;
	path: string;
	cwd: string;
	name: string | undefined;
	modified: string;
	evidence: string;
}

export interface SessionPatternResult {
	id: string;
	kind: "rule-based";
	recommendation: string;
	definition: string;
	sessionCount: number;
	examples: SessionPatternExample[];
}

export interface SessionPatternReport {
	sessionDir: string;
	sessionsAnalyzed: number;
	patterns: SessionPatternResult[];
}

export const SESSION_PATTERN_RULES: readonly SessionPatternRule[] = [
	{
		id: "context-pressure",
		recommendation: "Split or summarize work before context pressure and mid-task compactions accumulate.",
		definition: "Two or more compactions, or a compaction the agent kept working through in the same turn.",
		evaluate(facts) {
			const total = facts.compactions.length;
			const midTask = facts.compactions.filter((compaction) => compaction.midTask).length;
			if (total < 2 && midTask === 0) {
				return undefined;
			}
			const compactions = `${total} ${total === 1 ? "compaction" : "compactions"}`;
			return midTask === 0 ? compactions : `${compactions} (${midTask} mid-task)`;
		},
	},
	{
		id: "prompt-edits-unverified",
		recommendation: "Open the linked examples before changing prompts; tune only signals with poor outcome lift.",
		definition:
			"A prompt surface (AGENTS.md, CLAUDE.md, skills, prompt templates) was edited and nothing ran afterwards in the session.",
		evaluate(facts) {
			if (facts.promptSurfaceEdits.length === 0 || facts.ranCommandAfterLastPromptEdit) {
				return undefined;
			}
			const edited = facts.promptSurfaceEdits.map((path) => basename(path)).join(", ");
			return `edited ${edited} with nothing run afterwards`;
		},
	},
];

/** A path the agent edits to change its own instructions rather than the project it works on. */
export function isPromptSurfacePath(path: string): boolean {
	const normalized = path.replaceAll("\\", "/").toLowerCase();
	const name = basename(normalized);
	if (PROMPT_SURFACE_BASENAMES.has(name) || name.endsWith(".prompt.md") || name.endsWith(".prompt")) {
		return true;
	}
	if (name.includes("system-prompt") || name.includes("system_prompt")) {
		return true;
	}
	const segments = normalized.split("/");
	return segments.slice(0, -1).some((segment) => PROMPT_SURFACE_DIRECTORIES.has(segment));
}

/**
 * Extract facts from one session file. Returns undefined for files that are not
 * sessions. Lines stream so a large session never loads into memory at once.
 */
export async function analyzeSessionFile(path: string): Promise<SessionFacts | undefined> {
	let header: SessionHeader | undefined;
	let name: string | undefined;
	let userMessageCount = 0;
	const compactions: SessionCompactionFact[] = [];
	// Compactions waiting to learn whether the agent resumed the same turn.
	let unresolved: SessionCompactionFact[] = [];
	const promptSurfaceEdits: string[] = [];
	let toolCallIndex = 0;
	let lastPromptEditAt = -1;
	let lastCommandAt = -1;

	for await (const line of readLinesAsBuffers(path)) {
		const entry = parseEntry(line.toString("utf8"));
		if (!entry) {
			continue;
		}
		if (!header) {
			if (entry.type !== "session" || typeof (entry as SessionHeader).id !== "string") {
				return undefined;
			}
			header = entry as SessionHeader;
			continue;
		}

		if (entry.type === "compaction") {
			const compaction: SessionCompactionFact = {
				entryId: entry.id,
				timestamp: entry.timestamp,
				tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : 0,
				midTask: false,
			};
			compactions.push(compaction);
			unresolved.push(compaction);
			continue;
		}

		if (entry.type === "session_info") {
			name = entry.name ?? name;
			continue;
		}

		if (entry.type !== "message") {
			continue;
		}

		const message = entry.message;
		if (message.role === "user") {
			userMessageCount++;
			// A new user turn ends the task the compaction happened in.
			unresolved = [];
			continue;
		}
		if (message.role !== "assistant" && message.role !== "toolResult") {
			continue;
		}
		for (const compaction of unresolved) {
			compaction.midTask = true;
		}
		unresolved = [];
		if (message.role !== "assistant") {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "toolCall") {
				continue;
			}
			toolCallIndex++;
			if (COMMAND_TOOL_NAMES.has(block.name)) {
				lastCommandAt = toolCallIndex;
				continue;
			}
			if (block.name !== "edit") {
				continue;
			}
			const edited = readStringArgument(block.arguments, "path");
			if (!edited || !isPromptSurfacePath(edited)) {
				continue;
			}
			if (!promptSurfaceEdits.includes(edited)) {
				promptSurfaceEdits.push(edited);
			}
			lastPromptEditAt = toolCallIndex;
		}
	}

	if (!header) {
		return undefined;
	}

	return {
		path,
		id: header.id,
		cwd: header.cwd ?? "",
		name,
		modifiedMs: await modifiedTime(path),
		userMessageCount,
		compactions,
		promptSurfaceEdits,
		ranCommandAfterLastPromptEdit: lastPromptEditAt >= 0 && lastCommandAt > lastPromptEditAt,
	};
}

/** Facts for every session in a directory, ordered most recently modified first. */
export async function collectSessionFacts(sessionDir: string): Promise<SessionFacts[]> {
	let files: string[];
	try {
		files = (await readdir(sessionDir)).filter((file) => file.endsWith(".jsonl")).sort();
	} catch {
		return [];
	}

	const facts: SessionFacts[] = [];
	for (const file of files) {
		try {
			const analyzed = await analyzeSessionFile(join(sessionDir, file));
			if (analyzed) {
				facts.push(analyzed);
			}
		} catch {
			// An unreadable session is skipped rather than failing the whole report.
		}
	}
	return facts.sort((left, right) => right.modifiedMs - left.modifiedMs || left.id.localeCompare(right.id));
}

export function buildSessionPatternReport(
	sessionDir: string,
	facts: readonly SessionFacts[],
	options: { exampleLimit?: number; rules?: readonly SessionPatternRule[] } = {},
): SessionPatternReport {
	const exampleLimit = options.exampleLimit ?? DEFAULT_SESSION_PATTERN_EXAMPLES;
	const rules = options.rules ?? SESSION_PATTERN_RULES;
	const patterns = rules.map((rule) => {
		const matches: SessionPatternExample[] = [];
		for (const session of facts) {
			const evidence = rule.evaluate(session);
			if (evidence === undefined) {
				continue;
			}
			matches.push({
				id: session.id,
				path: session.path,
				cwd: session.cwd,
				name: session.name,
				modified: new Date(session.modifiedMs).toISOString(),
				evidence,
			});
		}
		return {
			id: rule.id,
			kind: "rule-based" as const,
			recommendation: rule.recommendation,
			definition: rule.definition,
			sessionCount: matches.length,
			examples: exampleLimit > 0 ? matches.slice(0, exampleLimit) : [],
		};
	});

	patterns.sort((left, right) => right.sessionCount - left.sessionCount || left.id.localeCompare(right.id));
	return { sessionDir, sessionsAnalyzed: facts.length, patterns };
}

export async function analyzeSessionPatterns(
	options: { sessionDir?: string; exampleLimit?: number } = {},
): Promise<SessionPatternReport> {
	const sessionDir = options.sessionDir ?? getSessionsDir();
	const facts = await collectSessionFacts(sessionDir);
	return buildSessionPatternReport(sessionDir, facts, { exampleLimit: options.exampleLimit });
}

function parseEntry(line: string): FileEntry | undefined {
	if (!line.trim()) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(line);
		if (typeof parsed !== "object" || parsed === null) {
			return undefined;
		}
		const entry = parsed as FileEntry;
		return typeof entry.type === "string" ? entry : undefined;
	} catch {
		return undefined;
	}
}

function readStringArgument(args: unknown, key: string): string | undefined {
	if (typeof args !== "object" || args === null) {
		return undefined;
	}
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function modifiedTime(path: string): Promise<number> {
	try {
		return (await stat(path)).mtimeMs;
	} catch {
		return 0;
	}
}
