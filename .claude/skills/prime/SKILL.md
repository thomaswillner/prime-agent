---
name: prime
description: Mandatory Prime Agent development pipeline for this repository - RAG retrieval, Tree-of-Thoughts exploration, Chain-of-Thought planning, implementation, and self-refinement, with evidence recorded for the enforcement hooks. Use BEFORE any coding or development work - implementing, fixing, refactoring, adding tests, or editing files. Triggers: implement, fix, bug, refactor, build, add feature, change code, write code, edit files.
---

# Prime Agent Pipeline

This repository enforces the Prime Agent protocol with hooks: file edits and mutating
shell commands are denied until phases are recorded, and the turn cannot end with
unrefined edits. This skill walks the pipeline inline. For large tasks, prefer
delegating to the `prime-agent` subagent, which runs the same pipeline with a fresh
context. All commands run from the repo root.

## 1. RAG - retrieve before you reason

Read (fully, not just search hits) the files the task touches, their callers/tests,
AGENTS.md, and relevant docs. Record >=3 real citations and a synthesis:

```
python3 .claude/hooks/prime_protocol.py rag --task "<work item>" \
  --source <file:lines> --source <file> --source <file> \
  --summary "<>=200 chars of what retrieval established>"
```

## 2. ToT - branch before you commit

Record >=3 distinct approaches, the chosen one, and an honest rationale:

```
python3 .claude/hooks/prime_protocol.py tot \
  --approach "A :: <desc >=60 chars>" --approach "B :: ..." --approach "C :: ..." \
  --chosen "A" --rationale "<why A, why not B/C, >=120 chars>"
```

## 3. CoT - plan the steps explicitly

```
python3 .claude/hooks/prime_protocol.py cot \
  --step "..." --step "..." --step "..." --step "..." --step "..." \
  --risk "<failure mode and the check for it>"
```

## 4. Implement

Edits are now unlocked. Follow AGENTS.md conventions strictly.

## 5. Self-refine - verify, then attest

Run `npm run check` after code changes, run any tests you added or changed until they
pass, re-read your diff adversarially and fix what you find, then:

```
python3 .claude/hooks/prime_protocol.py refine \
  --checks "<commands run and their results>" --verdict pass
```

`--verdict revise` records an unfinished pass; fix and refine again. The Stop hook
requires a passing refine that postdates the last edit.

## Utilities

- `python3 .claude/hooks/prime_protocol.py status` - show current gate state
- `python3 .claude/hooks/prime_protocol.py express --reason "..."` - audited fast path
  for genuinely trivial changes (disabled when PRIME_STRICT=1)
- `python3 .claude/hooks/prime_protocol.py reset --reason "..."` - abandon a cycle

Full contract: `.claude/ENFORCEMENT.md`.
