# Prime Agent delegation gate

One rule, enforced by Claude Code hooks: **coding and development work in this repo
is done by the prime-agent subagent, not the main thread.** The methodology the
prime-agent applies (RAG -> ToT -> CoT -> implement -> self-refine) is defined as
instructions in `CLAUDE.md` and `.claude/agents/prime-agent.md`; the hooks do not
police methodology phases - they only guarantee the prime-agent is actually invoked.

## Why a hook at all

`CLAUDE.md` is auto-loaded into every session and the `UserPromptSubmit` hook
re-injects the mandate on every prompt, so the instruction layer is always present,
including after context compaction. The one thing instructions cannot do is bind: a
drifting session could still edit directly. The `PreToolUse` gate closes that path
mechanically - the harness executes hooks on every matching tool call, outside the
model's control.

## Mechanics (all in `.claude/hooks/prime_enforcer.py`)

| Event | Action |
| --- | --- |
| `PreToolUse` on `Edit\|MultiEdit\|Write\|NotebookEdit` | Deny modifications of repo files while the gate is closed. Paths outside the repo are exempt. Every denial repeats the delegation instruction. |
| `PreToolUse` on `Bash` | Same for mutating commands: `git commit/push/merge/...`, `sed/perl -i`, redirects and `tee` into repo paths (quote-aware), package installs, `--write`/`--fix` fixers, file utilities aimed at repo paths. Read-only commands always pass. Direct access to `.claude/prime-state` is denied and logged as `TAMPER`. |
| `SubagentStart` / `SubagentStop` | Open/close the gate when the payload identifies a `prime-agent` run. |
| `SessionStart` / `UserPromptSubmit` | Inject the mandate plus live gate state. |

Gate state (`.claude/prime-state/gate.json`, gitignored):

- **Open while active**: a running prime-agent holds the gate open, bounded by
  `PRIME_ACTIVE_CAP_HOURS` (default 4) in case a stop event is lost.
- **Grace window**: after a run finishes, the gate stays open for
  `PRIME_GRACE_MINUTES` (default 30) so the main thread can commit, push, and do
  small follow-ups on the subagent's work. Expired grace means new coding work needs
  a new prime-agent run.
- **Fallback**: on surfaces without `SubagentStart` hooks, the prime-agent's own
  instructions open the gate via `python3 .claude/hooks/prime_enforcer.py open`
  (logged as `MANUAL_OPEN`) and close it when done.

## Operations

- `python3 .claude/hooks/prime_enforcer.py status` - gate state and settings
- `.claude/prime-state/compliance.log` - every open, close, denial, tamper attempt,
  and manual override, timestamped
- Env (e.g. via `.claude/settings.local.json`): `PRIME_ENFORCE=0` disables the gate,
  `PRIME_GRACE_MINUTES`, `PRIME_ACTIVE_CAP_HOURS`
- Local Claude Code CLI asks once to approve project hooks; remote sessions pick
  them up on the next session after merge. Sessions already running when the hooks
  land keep their old snapshot until restarted.

## Limits, stated honestly

This is drift-prevention, not a security sandbox: the enforcer runs with the same
privileges as the session, exotic shell quoting could evade the Bash heuristics, and
the main thread shares the open gate while a prime-agent run is active or in grace.
What it guarantees: the normal edit path in the main thread is closed until a
prime-agent invocation happens, every denial re-teaches the delegation, and the
audit log shows whether the mandate was honored.

## File map

```
CLAUDE.md                        mandate + methodology (auto-loaded)
.claude/settings.json            hook wiring + PRIME_ENFORCE default
.claude/hooks/prime_enforcer.py  gate: hook dispatcher + status/open/close CLI
.claude/agents/prime-agent.md    the implementation subagent (methodology lives here)
.claude/prime-state/             gate state + compliance.log (gitignored)
```
