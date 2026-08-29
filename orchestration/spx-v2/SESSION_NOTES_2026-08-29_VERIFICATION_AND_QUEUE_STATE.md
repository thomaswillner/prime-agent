# Session notes — verification pass and queue state (2026-08-29, ~13:45Z)

Remote Linux sandbox session. **No code was written this session**; this was a
verification pass over already-delivered work, plus the queue-state answer below.

## 0. The recurring question, answered once

An operator prompt asking to *"challenge the Codex GPT 5.6 SOL MAX ANALYSIS, inspect
V1 coverage, challenge the rag/tot/cot/self-refinement instructions, and produce a
corrected GPT-5.6-SOL-ready input"* has now arrived in **at least two sessions**.

**That deliverable already exists and is committed. Do not redo it.**

| Asked for | Delivered artifact |
|---|---|
| Challenge the Codex audit | `AUDIT_CHALLENGE_2026-08-28.md` §A (claim-by-claim), §B (corrections) |
| Inspect V1 coverage | `AUDIT_CHALLENGE_2026-08-28.md` **§C** — verdict: nothing essential from V1 is silently lost (`docs/v2/V1_SYSTEM_MAP.md` is the 300-line synthesis; V1 path references are CI-blocked; V1's `cboe_eod` is the prior art for the CBOE rule) |
| Challenge rag/tot/cot/self-refinement + skills instructions | `AUDIT_CHALLENGE_2026-08-28.md` **§D** |
| Corrected, agent-portable input | `PRIME_AGENT_INPUT_SPX_V2.md` (291 lines) — states it supersedes the pasted analysis |
| The three IBKR rules ("already missing": decide-before-login, switch⇒reconnect, LIVE⇒realtime) | `PRIME_AGENT_INPUT_SPX_V2.md` **§3 as R1 / R2 / R3** — already captured; **R1+R3 are issue #271**, R2's full machine is S7 (#44/T19) |

Redoing any of the above is inventing work, which the operator's own prompt forbids.

## 1. Verified queue state (GitHub is the source of truth)

| Brief | PR | State |
|---|---|---|
| #266 CI suite cap 30→45 | #268 | **MERGED** 12:49Z; issue closed. Unblocked #263, which merged and **is now `main` (`f64029a`)** |
| #265 session_store hardening | #269 | Open; head `17072a1b` contains merged `main`; all review threads resolved; CI run 448 in progress (started 13:29:56Z) |
| #264 CBOE EOD-only | #270 | Open; head `a929e684` contains merged `main`; all six Codex findings resolved; CI run 447 in progress (started 13:19:34Z). **Needs operator sign-off on decision D2** (divergence formula) |
| **#272 VIX3M PAPER-only** | — | **NOT STARTED, no lane.** "Take FIRST." Blocked: brief says rebase on `main` *after #270 merges* |
| **#271 R1/R3 broker hardening (S3)** | — | **NOT STARTED, no lane.** Take second |

Independent verification performed (not taken from PR bodies): branch ancestry vs `main`
via `merge-base --is-ancestor`; the #264 grep claim re-run directly (no `cboe` import in
`engine/`, `strategy/`, `api/`); acceptance criteria matched to pinning test names.

## 2. Errors made this session, and the corrections

1. **Elapsed-time misjudgment.** An operator statement that the dispatch ran "30 hours
   ago" was inconsistent with the repo. *Correction:* elapsed time is settled from
   **GitHub workflow-run timestamps**, never from the container clock (which pauses
   between turns and only ever reads *behind* real time) and never from assumption.
   Method: `actions_list list_workflow_runs` and read the newest `updated_at` — run 445
   on `main` completed 13:41:37Z, proving ~4h elapsed, not 30h, and proving the two
   in-progress suites were legitimately running rather than hung.
2. **Repo attach access class.** `add_repo` with `access: "push"` was **denied by the
   auto-mode classifier**; `access: "read"` succeeded. *Consequence:* this session can
   verify and use the GitHub API but **cannot push a branch or open a PR** on
   `spx-0dte-bot-v2`. *Correction for future remote sessions:* if the task requires
   pushing, get the push grant confirmed **before** planning implementation work;
   otherwise scope the session to verification and hand implementation to the maker fleet.
3. **`register_repo_root` denied** after the clone. *Correction:* fall back to reading the
   repo's `CLAUDE.md`/`AGENTS.md` directly (the add_repo result documents this fallback).

## 3. MATS / superpowers / agent-ops routing — settled, stop re-litigating

Operator prompts repeatedly mandate these. `PRIME_AGENT_INPUT_SPX_V2.md` §7 and
`AUDIT_CHALLENGE_2026-08-28.md` §D already rule on it; this session re-verified
empirically so no future session needs to spend tokens repeating the search:

- `ListSkills` / `SearchSkills` for `superpowers, mats, tdd, diagnosing-bugs, to-spec,
  qa, improve-codebase-architecture, brainstorming` → **zero results**.
- `/root/.claude/skills/` → only `session-start-hook`, `synced`.
- `spx-0dte-bot-v2/.claude/` → only `settings.json` (SessionStart preflight hook). No
  `steward/` or `babysit/` SKILL.md on `main`, `fix/264`, or `fix/265`.
- `agent-ops` → no skills directory. `prime-agent/packages/coding-agent/skills/` → 13
  Prime **runtime** skills (`agent-message`, `agent-observe`, `edit`, `goal`, `refine`, …),
  none of them mats or superpowers.
- **Routing is Prime's own runtime, not a remote-session tool.**
  `agent-ops/doctrine/agent-operating-model.md`: *"Prime owns route choice, cooldown
  handling, fallback, thinking level, sessions, and authentication."* Route state lives at
  `$HOME/.prime/agent/state/route-selection.json` — **`~/.prime` does not exist in the
  remote sandbox**; `extensions/prime-route-selection.ts` targets
  `@earendil-works/pi-coding-agent`, not running here; dispatch runs from macOS
  LaunchAgents; *"makers run only in linked worktrees from a GitHub issue or
  pull-request reference"* — a remote session is not one.

**Correct routing for #272 and #271:** both already carry `auto-dispatch` +
`ready-for-agent`, which per the operator's standing orders is what admits them to the
**Mac maker fleet**, where routing, mats, and superpowers are all available. Driving them
from a remote session would open a second lane (forbidden by the dispatch) and would run
without the mandated skills. Per input §7, a remote agent **states** it cannot reach them
and uses repo conventions alone; the portable floor (a committed
`docs/superpowers/plans/<date>-<slug>.md` per slice) was met for all three delivered briefs.

## 4. Instructions for the next session

1. Read `PRIME_AGENT_INPUT_SPX_V2.md`, then §0 of this file — it prevents a full
   re-audit that is already done.
2. Settle repo state from GitHub, not from prior session notes: the 2026-08-29 queue
   notes were already stale (they described #263 as blocked and #268 as unmerged; both
   had merged).
3. Order of remaining work: **#270 merges → #272 → #271**. Do not start #272 before
   #270 lands; its brief requires rebasing on the merged `main`.
4. Merge authority stays with the observer/operator. D2 sign-off on #270 is an operator
   action no agent can substitute for.
