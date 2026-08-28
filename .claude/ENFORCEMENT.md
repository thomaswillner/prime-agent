# Prime Agent Protocol Enforcement

This document is the contract for how the Prime Agent development protocol
(RAG -> ToT -> CoT -> implement -> self-refine) is *forced*, not merely requested,
for Claude Code sessions in this repository, and what guarantees that gives.

## Why hooks, not instructions

Instructions (CLAUDE.md, skills, agent prompts) steer the model but cannot bind it:
under context pressure a model can drift, summarize them away, or rationalize a
shortcut. Claude Code **hooks** are different: the harness executes them on every
matching event, outside the model's control, and their deny/block decisions are
applied mechanically. Compliance therefore does not depend on the model remembering
or agreeing - the normal tool path is physically closed until the protocol state
machine says otherwise.

## The enforcement loop

All hooks route through `.claude/hooks/prime_enforcer.py`; evidence is recorded and
validated by `.claude/hooks/prime_protocol.py`; state lives in
`.claude/prime-state/` (gitignored, per checkout).

| Event | Action |
| --- | --- |
| `SessionStart` | Injects the protocol briefing and live gate state into context. |
| `UserPromptSubmit` | Re-injects the mandate + current state on every user prompt (immune to context loss and compaction). |
| `PreToolUse` on `Edit\|MultiEdit\|Write\|NotebookEdit` | Denies any modification of files inside the repo until `rag`, `tot`, and `cot` are recorded and fresh. Paths outside the repo (scratch, /tmp) are exempt. Every denial re-teaches the exact compliance commands. |
| `PreToolUse` on `Bash` | Same gate for mutating commands: `git commit/push/merge/rebase/...`, `sed/perl -i`, `tee`/redirects targeting repo paths, `npm/pnpm/yarn/bun install/...`, `--write`/`--fix` fixers, and file utilities (`mv/cp/rm/touch/mkdir/...`) aimed at repo paths. Read-only research is never blocked. Any direct access to `.claude/prime-state` outside the recorder is denied and logged as `TAMPER`. |
| `PostToolUse` on edit tools | Counts gated edits and timestamps the last one - this arms the refine requirement. |
| `Stop` | Blocks ending the turn while gated edits exist without a `refine --verdict pass` recorded *after* the last edit. Yields after `PRIME_MAX_STOP_BLOCKS` (default 3) to prevent livelock, logging a `VIOLATION`. |

### Evidence validation (what "recorded" means)

The recorder rejects hollow compliance:

- `rag`: >=3 cited sources (files must actually exist; `http(s)://`/`doc:` refs
  allowed), a task description, and a >=200 char synthesis. Opens a cycle; clears
  stale `tot`/`cot`.
- `tot`: >=3 distinctly named approaches with >=60 char descriptions, a `--chosen`
  matching one of them, and a >=120 char rationale. Requires `rag` first.
- `cot`: >=5 steps (>=20 chars each) plus >=1 named risk. Requires `tot` first.
- `refine`: requires a complete protocol and >=1 gated edit, a >=80 char report of
  the checks actually run, and a `pass`/`revise` verdict. Only a `pass` newer than
  the last edit satisfies the Stop gate; each later edit re-arms it.
- Freshness: a completed protocol expires after `PRIME_TTL_HOURS` (default 8) of
  inactivity, so evidence cannot be reused across unrelated work.

### Steering layer (defense in depth)

- `CLAUDE.md` - the mandate, auto-loaded into every session.
- `.claude/skills/prime/SKILL.md` - `/prime`, the guided pipeline.
- `.claude/agents/prime-agent.md` - a subagent that runs the full pipeline; its
  edits pass through the same hooks (hooks apply to subagents too), so delegation
  cannot bypass the gate.

## Operations

- Inspect: `python3 .claude/hooks/prime_protocol.py status`
- Audit trail: `.claude/prime-state/compliance.log` records every phase, denial,
  tamper attempt, stop-block, express use, reset, and violation with timestamps.
- Express lane: `... express --reason "<>=40 chars>"` for trivial changes - logged,
  still requires refine, disabled by `PRIME_STRICT=1`.
- Tuning (env, e.g. via `.claude/settings.local.json`): `PRIME_ENFORCE=0` disables
  gating (for humans running Claude Code who opt out locally), `PRIME_STRICT=1`
  kills the express lane, `PRIME_TTL_HOURS`, `PRIME_MAX_STOP_BLOCKS`.
- Local Claude Code CLI asks once to approve project hooks; claude.ai remote
  sessions pick them up automatically on the next session after merge. A session
  that was already running when these hooks landed keeps its old hook snapshot
  until restarted.

## Guarantees and honest limits

What is guaranteed: hooks fire on 100% of matching events; the deny/block decisions
are mechanical; evidence is structurally validated; everything is auditable in the
compliance log. A session cannot take the normal edit path, commit, or end a turn
with unrefined edits without the protocol being satisfied, and every denial repeats
the required commands, so drift self-corrects.

What is not guaranteed: this is process enforcement against drift and laziness, not
a security sandbox against an adversarial agent - the enforcer runs with the same
privileges as the session. Residual gaps, accepted deliberately: exotic shell
quoting or interpreters invoked with inline code could evade the Bash mutation
heuristics; evidence quality above the structural thresholds (length, counts,
existing files, ordering, freshness) is judged by the model itself; and quality of
*reasoning* inside RAG/ToT/CoT cannot be machine-checked - the hooks force the
phases to happen and be documented, which is what makes lapses visible in the audit
log and in review. This mirrors the repository's own trust model (see the README
warning): trusted repo, untrusted lapses - not hostile actors.

## File map

```
CLAUDE.md                        mandate (auto-loaded)
.claude/settings.json            hook wiring + PRIME_ENFORCE default
.claude/hooks/prime_enforcer.py  hook dispatcher (all events)
.claude/hooks/prime_protocol.py  evidence recorder / validator / state library
.claude/agents/prime-agent.md    pipeline subagent
.claude/skills/prime/SKILL.md    /prime guided pipeline
.claude/prime-state/             runtime state + compliance.log (gitignored)
```
