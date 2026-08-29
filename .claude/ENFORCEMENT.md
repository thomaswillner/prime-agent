# Prime Agent delegation gate

One rule, enforced by Claude Code hooks: **all development work in this repo is done
by the Prime Agent runtime** - the agent framework this repository ships
(`prime-agent`, Prime Intellect's self-improving RLM coding agent) - never by Claude
Code's main thread. The gate only guarantees the runtime is actually engaged; it
polices nothing else. What the runtime is asked to do, and how its work is
admitted, observed, and verified, belong to the existing orchestration system:
the `thomaswillner/agent-ops` repo (admission, worktree isolation, evidence,
landing gates via `maker-run.sh`) plus this repo's `orchestration/<workstream>/`
verification artifacts - see CLAUDE.md.

## Why a hook at all

`CLAUDE.md` is auto-loaded into every session and a short `UserPromptSubmit`
injection repeats the mandate on every prompt, so the instruction layer is always
present, including after context compaction. The one thing instructions cannot do is
bind: a drifting session could still edit directly. The `PreToolUse` gate closes
that path mechanically - the harness executes hooks on every matching tool call,
outside the model's control.

## Mechanics (all in `.claude/hooks/prime_enforcer.py`)

| Piece | Action |
| --- | --- |
| `run --task "..." [-- extra args]` (CLI) | The compliant path: resolves the runtime (`$PRIME_AGENT_BIN`, `prime-agent` on PATH, or `./prime-agent.sh`), opens the gate, executes `prime-agent -p <task>` headlessly from the repo root, and on success closes into the grace window. A failed run grants no grace; a missing runtime leaves the gate closed and says so. |
| `PreToolUse` on `Edit\|MultiEdit\|Write\|NotebookEdit` (hook) | Deny modifications of repo files while the gate is closed. Paths outside the repo are exempt. Every denial repeats the dispatch instruction. |
| `PreToolUse` on `Bash` (hook) | Same for mutating commands: `git commit/push/merge/...`, `sed/perl -i`, redirects and `tee` into repo paths (quote-aware), package installs, `--write`/`--fix` fixers, file utilities aimed at repo paths. Read-only commands always pass, as does anything invoking `prime_enforcer.py`. Direct access to `.claude/prime-state` is denied and logged as `TAMPER`. |
| `SessionStart` / `UserPromptSubmit` (hooks) | Inject a short mandate line plus live gate state. |
| `status` / `open` / `close` (CLI) | Inspect the gate; `open`/`close` are the logged manual fallback (`MANUAL_OPEN` in the audit log) for maintaining the enforcement layer itself. |

Gate state (`.claude/prime-state/gate.json`, gitignored):

- **Open while a run is active**, bounded by `PRIME_ACTIVE_CAP_HOURS` (default 4) in
  case a run never reports finishing.
- **Grace window**: after a successful run the gate stays open for
  `PRIME_GRACE_MINUTES` (default 30) so the main thread can commit, push, and do
  small follow-ups on what the runtime produced. Expired grace means new development
  work needs a new run.

## Operations

- `python3 .claude/hooks/prime_enforcer.py status` - gate state and settings
- `.claude/prime-state/compliance.log` - every run (start/ok/failed/unavailable),
  open, close, denial, tamper attempt, and manual override, timestamped
- Env (e.g. via `.claude/settings.local.json`): `PRIME_ENFORCE=0` disables the gate,
  `PRIME_AGENT_BIN` pins the runtime binary, `PRIME_GRACE_MINUTES`,
  `PRIME_ACTIVE_CAP_HOURS`
- The runtime must be installed and authenticated wherever Claude Code runs. Where
  it is not (e.g. a fresh cloud container without provider keys), the gate stays
  closed for coding work by design; provision `PRIME_AGENT_BIN`/keys or set
  `PRIME_ENFORCE=0` deliberately.
- Local Claude Code CLI asks once to approve project hooks; remote sessions pick
  them up on the next session after merge. For a machine-wide mandate, CLAUDE.md
  documents a block to copy into `~/.claude/CLAUDE.md`.

## Limits, stated honestly

This is drift-prevention, not a security sandbox: the enforcer runs with the same
privileges as the session, exotic shell quoting could evade the Bash heuristics, and
the gate is shared (the main thread can also edit during an active run or grace).
What it guarantees: the normal edit path in the main thread is closed until the
Prime Agent runtime has actually been engaged, every denial re-teaches the dispatch
command, and the audit log shows whether the mandate was honored.

## File map

```
CLAUDE.md                        mandate + global-CLAUDE.md block (auto-loaded)
.claude/settings.json            hook wiring + PRIME_ENFORCE default
.claude/hooks/prime_enforcer.py  gate: hooks + run/status/open/close CLI
.claude/prime-state/             gate state + compliance.log (gitignored)
```
