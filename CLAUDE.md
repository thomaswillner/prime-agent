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

## Orchestration (already exists - do not duplicate it)

The **prime orchestration repo is `thomaswillner/agent-ops`** ("Prime-owned maker
operations"): it owns admission (GitHub issues are the complete task spec; briefs
are thin pointers), worktree isolation, bounded execution, runtime identity
evidence, landing checks, and release gates for `prime-agent` - see its
`doctrine/agent-operating-model.md`, `policy/pipeline-policy.json`, and
`scripts/maker-run.sh` (gates -> lock -> contract -> adapter loop -> LANDING GATE),
with `focus.yaml` pointing the maker fleet at the current target repo. On the Mac
estate, dispatch Prime Agent work through that pipeline; the `run --task` wrapper
here is the in-repo path for surfaces without agent-ops. Prime exclusively owns
provider, model, cooldown, fallback, and thinking-level selection - never pass
those flags.

Workstream verification artifacts also live in this repo under
`orchestration/<workstream>/`: the implementation input of record
(`PRIME_AGENT_INPUT_*.md`), the audit challenge (`AUDIT_CHALLENGE_*.md`), and
session learnings (`SESSION_LEARNINGS_*.md` - the SessionStart hook injects the
latest learnings into every session automatically). Dispatched tasks trace to the
input of record; verification lands back there. The gate below only enforces *who*
implements (the runtime); *what* and *verification* belong to agent-ops and these
artifacts.

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
