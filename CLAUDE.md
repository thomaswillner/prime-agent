# Prime Agent mandate (enforced)

**All development work in this repository is done by the Prime Agent runtime** - the
agent framework this repository ships (`prime-agent`, Prime Intellect's self-improving
RLM coding agent). Claude Code never implements directly. To do coding work, dispatch
the complete task to the runtime:

```bash
python3 .claude/hooks/prime_enforcer.py run --task "<the full task>"
```

That drives `prime-agent -p` headlessly (extra CLI args pass through after `--`, e.g.
`-- --autonomous --autonomous-gate "npm run check"`). While the runtime works, and for
a grace window after a successful run, the gate is open so the main thread can commit
and push the result.

This is enforced, not advisory: `PreToolUse` hooks in `.claude/settings.json` deny
file edits and mutating shell commands in the main thread while no prime-agent run is
active or recent. Research, questions, and read-only commands are never blocked.

Runtime resolution: `$PRIME_AGENT_BIN`, else `prime-agent` on PATH, else
`./prime-agent.sh` in this checkout. If none is available the gate stays closed - say
so instead of implementing directly.

`python3 .claude/hooks/prime_enforcer.py status` shows the gate; `PRIME_ENFORCE=0`
(e.g. in `.claude/settings.local.json` env) disables it locally. Details:
`.claude/ENFORCEMENT.md`.

## Orchestration layer (already exists - do not duplicate it)

This repository is also the **orchestrating repo**: `orchestration/<workstream>/`
(e.g. `orchestration/spx-v2/`) observes, orchestrates, and verifies all Prime Agent
work. Per workstream it holds the **implementation input of record**
(`PRIME_AGENT_INPUT_*.md` - the evidence-anchored task handed to the runtime), the
**audit challenge** (`AUDIT_CHALLENGE_*.md` - verification of claims against the
target repos), and **session learnings** (`SESSION_LEARNINGS_*.md` - read the
workstream's learnings first; do not repeat recorded mistakes). Dispatched tasks
must trace to the relevant input of record, and verification outcomes are recorded
back there. The gate below only enforces *who* implements (the runtime);
*what* to do and *whether it is verified* belong to the orchestration layer.

## Machine-wide mandate (global CLAUDE.md)

To apply the mandate on a machine for every project, add this block to
`~/.claude/CLAUDE.md`:

```markdown
# Prime Agent mandate
All development work is done by the Prime Agent runtime (`prime-agent`), never by
Claude Code directly. For any coding task, dispatch it to prime-agent (headless:
`prime-agent -p "<task>"`; in the prime-agent repo use
`python3 .claude/hooks/prime_enforcer.py run --task "<task>"` so the enforcement
gate opens for commit/push). Only commit, push, and report what the runtime produced.
```

# Repository conventions

Development rules (style, commands, git discipline, changelogs, releases) live in
`AGENTS.md` and apply in full. Highlights:

- After code changes run `npm run check`; never `npm run dev`, `npm run build`, or
  `npm test`. Run specific tests from the package root only when needed.
- Stage files individually (`git add <path>`); never `git add -A`, never
  `git commit --no-verify`, never force-push.
- Tests you create or modify must be run and iterated until they pass.
