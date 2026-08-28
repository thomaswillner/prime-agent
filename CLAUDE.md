# Prime Agent mandate (enforced)

All coding and development work in this repository is done by the **prime-agent
subagent** (`.claude/agents/prime-agent.md`). Do not implement directly in the main
thread: delegate the complete task with the Task tool, `subagent_type: "prime-agent"`.

This is enforced, not advisory: `PreToolUse` hooks in `.claude/settings.json` deny
file edits and mutating shell commands in the main thread while no prime-agent run is
active or recent. The gate opens automatically during a run and for a grace window
afterwards so the main thread can commit and push the result. Research, questions,
and read-only commands are never blocked.

`python3 .claude/hooks/prime_enforcer.py status` shows the gate; `PRIME_ENFORCE=0`
(e.g. in `.claude/settings.local.json` env) disables it locally. Details:
`.claude/ENFORCEMENT.md`.

# Repository conventions

Development rules (style, commands, git discipline, changelogs, releases) live in
`AGENTS.md` and apply in full. Highlights:

- After code changes run `npm run check`; never `npm run dev`, `npm run build`, or
  `npm test`. Run specific tests from the package root only when needed.
- Stage files individually (`git add <path>`); never `git add -A`, never
  `git commit --no-verify`, never force-push.
- Tests you create or modify must be run and iterated until they pass.
