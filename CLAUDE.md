# Prime Agent Protocol (mandatory)

All coding and development work in this repository MUST run through the Prime Agent
pipeline: **RAG -> ToT -> CoT -> implement -> self-refine**. This is not advisory; it is
enforced by deterministic hooks in `.claude/settings.json`:

- `PreToolUse` hooks DENY file edits and mutating shell commands (git commit/push,
  `sed -i`, redirects into the repo, package installs, etc.) until machine-validated
  evidence of RAG, ToT, and CoT is recorded.
- A `Stop` hook BLOCKS ending a turn while edits lack a passing self-refinement pass.
- `SessionStart` and `UserPromptSubmit` hooks inject the protocol and its live state
  into every turn.

## How to comply (run from repo root)

1. **RAG** - read the governing code/docs fully, then record >=3 real citations:
   `python3 .claude/hooks/prime_protocol.py rag --task "..." --source <file:lines> --source <file> --source <file> --summary "<>=200 chars>"`
2. **ToT** - record >=3 distinct approaches and the choice:
   `python3 .claude/hooks/prime_protocol.py tot --approach "A :: ..." --approach "B :: ..." --approach "C :: ..." --chosen "A" --rationale "<>=120 chars>"`
3. **CoT** - record the ordered plan and risks:
   `python3 .claude/hooks/prime_protocol.py cot --step "..." (x5+) --risk "..."`
4. **Implement** - edits unlock only after 1-3.
5. **Self-refine** - run `npm run check` / relevant tests, review your own diff
   adversarially, then:
   `python3 .claude/hooks/prime_protocol.py refine --checks "<what ran and results>" --verdict pass`

Use the `/prime` skill for the guided pipeline, or delegate the whole task to the
`prime-agent` subagent. `python3 .claude/hooks/prime_protocol.py status` shows the gate
state. Genuinely trivial changes may use the audited express lane
(`... express --reason "..."`); it is logged and disabled under `PRIME_STRICT=1`.

Pure research, questions, and read-only analysis require no protocol.

Full contract, operations, and threat model: `.claude/ENFORCEMENT.md`.

# Repository conventions

Development rules (style, commands, git discipline, changelogs, releases) live in
`AGENTS.md` and apply in full. Highlights that interact with the protocol:

- After code changes run `npm run check`; never `npm run dev`, `npm run build`, or
  `npm test`. Run specific tests from the package root only when needed.
- Stage files individually (`git add <path>`); never `git add -A`, never
  `git commit --no-verify`, never force-push.
- New tests you write must be run and iterated until they pass - report this in the
  refine phase.
