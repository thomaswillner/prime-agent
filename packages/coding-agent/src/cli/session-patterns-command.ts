/**
 * `session patterns` - report deterministic, rule-based patterns across saved sessions.
 */

import { APP_NAME } from "../config.js";
import {
	analyzeSessionPatterns,
	DEFAULT_SESSION_PATTERN_EXAMPLES,
	type SessionPatternReport,
} from "../core/session-patterns.js";

export interface SessionPatternsOptions {
	json: boolean;
	exampleLimit: number;
	sessionDir?: string;
}

export type SessionPatternsArgs = { ok: true; options: SessionPatternsOptions } | { ok: false; error: string };

export function parseSessionPatternsArgs(args: readonly string[]): SessionPatternsArgs {
	const options: SessionPatternsOptions = { json: false, exampleLimit: DEFAULT_SESSION_PATTERN_EXAMPLES };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--session-dir") {
			const value = args[++index];
			if (value === undefined || value.startsWith("-")) {
				return { ok: false, error: `Missing value for ${arg}.` };
			}
			options.sessionDir = value;
			continue;
		}
		if (arg === "--examples") {
			const value = args[++index];
			if (value === undefined) {
				return { ok: false, error: `Missing value for ${arg}.` };
			}
			const parsed = Number(value);
			if (!Number.isInteger(parsed) || parsed < 0) {
				return { ok: false, error: `--examples requires a non-negative integer, got "${value}".` };
			}
			options.exampleLimit = parsed;
			continue;
		}
		return { ok: false, error: `Unknown option for session patterns: ${arg}` };
	}
	return { ok: true, options };
}

export function formatSessionPatternReport(report: SessionPatternReport): string {
	const sessions = `${report.sessionsAnalyzed} ${report.sessionsAnalyzed === 1 ? "session" : "sessions"}`;
	if (report.sessionsAnalyzed === 0) {
		return `No sessions found in ${report.sessionDir}`;
	}

	const blocks = report.patterns.map((pattern) => {
		const lines = [
			"Rule-based",
			pattern.recommendation,
			`${pattern.sessionCount} of ${report.sessionsAnalyzed} sessions have this deterministic pattern.`,
			`Rule: ${pattern.definition}`,
		];
		if (pattern.examples.length > 0) {
			lines.push("Examples:");
			for (const example of pattern.examples) {
				const location = example.name ?? example.cwd;
				lines.push(`  ${example.id}  ${example.evidence}${location ? `  ${location}` : ""}`);
			}
			lines.push(`  Open one with: ${APP_NAME} --resume ${pattern.examples[0]!.id}`);
		}
		return lines.join("\n");
	});

	return [`Analyzed ${sessions} in ${report.sessionDir}`, ...blocks].join("\n\n");
}

export async function runSessionPatterns(options: SessionPatternsOptions): Promise<void> {
	const report = await analyzeSessionPatterns({
		sessionDir: options.sessionDir,
		exampleLimit: options.exampleLimit,
	});
	console.log(options.json ? JSON.stringify(report, null, 2) : formatSessionPatternReport(report));
}
