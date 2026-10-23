# Lessons — SPX V2 orchestration

Durable, non-time-bound. **Read before starting work.** Point-in-time session
notes are deliberately not kept here: they go stale, contradict `main`, and
mislead the next reader. Current state lives in [`STATE.md`](STATE.md); history
lives in git.

## RULE 0 — Prime Agent writes the code. You do not. Read this before anything else.

`agent-ops/CLAUDE.md` standing order 1: **Prime Agent is the only development
and coding agent. All code — in any repository, or outside one — is written by
Prime Agent, dispatched through the admission machinery: a GitHub issue as the
complete task specification, and the `auto-dispatch` label admitting it to the
maker fleet. A Claude session never writes, edits, or commits code.**

Standing order 3: Claude sessions are **observers and verifiers only** — write
issue briefs, dispatch, verify a delivered PR against its brief, land what is
green and brief-exact under the operator's merge authority, report, and
maintain Prime Agent continuity.

### What drift looks like, from the session that did it (2026-08-29/30)

It does not announce itself. It looks like being helpful:

- The operator says "the repo is not clean" → **editing files to clean it**,
  instead of filing the brief. (`spx#290`, the render deletions.)
- The operator is blocked on a stale doc → **fixing the doc directly**, instead
  of filing the brief. (`spx#292`, the IBC plist and INSTALL.md.)
- Neither touched a `.py` file, which is exactly why it felt fine. The order
  says **all code, any repository** — and repo files in the product repo are the
  fleet's lane whether or not they end in `.py`.

The tell in every case: *"this is small, I can just do it."* That sentence is
the drift. Small is what the fleet is for; the dispatch is cheap and the lane is
auditable.

### The one legitimate exception, and its exact shape

An operator prompt that explicitly re-designates the session — *"You are Prime
Agent, the sole implementing developer for X"* — IS a dispatch, and code written
under it is in-role. That authority covers **the briefs named in that prompt**
and nothing else. When those briefs are delivered, the session reverts to
observer. It does not carry the designation forward into unrelated work.

### What to do instead, every time

1. Write the brief as an issue comment (or a new issue), with acceptance
   criteria, anchors verified against current `main`, and out-of-scope stated.
2. Apply `auto-dispatch` + `ready-for-agent`.
3. Verify the PR the fleet returns, against the brief.
4. If it is green and brief-exact, land it under the operator's merge authority.

Writing in the orchestration repo (`STATE.md`, `LESSONS.md`, session records) is
continuity, not code, and stays in-role. Everything in a product repository does
not.

## Method

1. **Settle repo state from GitHub, never from notes — including this repo's.**
   Session notes have been wrong within hours, twice. Read `main`, the issues
   and the workflow runs.
2. **Never infer a capability from a label — test it.** "I cannot push" was
   inferred from a tool returning `access: "read"` and was wrong; the git
   credential path is separate. `git push --dry-run` authenticates and writes
   nothing. The push *form* matters: `git push -u origin <branch>` passes where
   the `HEAD:branch` refspec form is denied.
3. **Elapsed time comes from GitHub timestamps.** The container clock pauses
   between turns and only ever reads *behind* real time.
4. **State absence claims with their searched scope.** "Not found in X, Y, Z",
   never "does not exist" — the operator's estate is larger than a sandbox's view.
5. **Search the target repo before concluding from the agent's own tooling.**
   "Superpowers" is the V2 repo's own SDD convention (`docs/superpowers/`), not
   an agent plugin.
6. **In this monorepo, runtime authority is under `apps/server/`, domain
   libraries under `packages/`.** Search both before claiming absence.
7. **Check `DECISIONS_LOG.md` before calling any behaviour a defect.** It is the
   top authority. The intraday CBOE role was a recorded operator decision, not a
   bug — the fix path was a superseding row first, then code.
8. **"Shipped" and "deployed" are different identities.** Repo default vs the
   Mac's live config. Always name which one.
9. **Verify every path or name an upstream analysis presents as existing.** Two
   "facts" in the Codex audit were proposals that appear nowhere in the repo.

## Scope

10. **A finding that maps to an acceptance criterion is in scope by definition.**
    On #273 a reviewer's P1 was a gap I had spotted and deferred as scope creep;
    the brief's criterion said *"Test proves TradingView VIX3M can never satisfy
    LIVE"*, which the fidelity-only flag did not deliver. "No scope creep" never
    outranks an acceptance checkbox.
11. **Mac-runtime claims are operator receipts, not repo facts.** Re-prove at
    runtime; never treat them as verified by reading.
12. **Do not invent scope.** Every change traces to input §5 or a named open
    issue; discovered extras are reported as proposals.

## Evidence and claims

13. **Never publish a test claim you have not run in the form you state it.**
    "Passes in isolation" and "reproduces on untouched `main`" are different
    claims with different evidence. One was published without executing it, and
    was false; the conclusion survived only because the other was true.
14. **When a change makes a new KIND of thing enter an existing collection,
    re-read every invariant asserted over that collection.** An invariant that
    "every live blocker carries a traced root cause" held only because every
    blocker until then was an element nobody had fetched.
15. **A fast CI failure: check the step count first** (`list_workflow_jobs`),
    then the same workflow on `main`. Zero steps recorded is infrastructure, never
    logic. Two cheap calls separate the two before reading a single log.
16. **"Known flake" decays into a load-bearing excuse.** The #58 alert-bridge
    race was carried as a standing exception across a whole train of PRs and was
    then simply fixed (#279). Check whether an exception still exists before
    quoting it.

## Process

17. **The PR body becomes the squash commit message.** A body left stale after a
    review round writes false claims into `main` permanently, and a reply on a
    review thread does not reach it. Rewrite the body before merge; record
    corrections in it rather than deleting the wrong text.
18. **A title reference is not a closing keyword.** `… (#271)` leaves the issue
    open; only `fixes #N` in the body closes it. Three delivered issues sat open
    this way, so `make open-work` offered finished briefs as ready. The mirror
    hazard is in the V2 `CLAUDE.md`: a keyword written as an *example* closed a
    live P1.
19. **`git branch --show-current` before every commit in multi-branch sessions**,
    and treat an unexpected "Everything up-to-date" push as an error signal.
20. **Write implementation-time errors into the V2 repo's own
    `.learnings/ERRORS.md` and `.learnings/LEARNINGS.md`**, not only here.
21. **Never develop in the V1 repo, and never reference the v1 path inside V2** —
    it is CI-gated.

## Operator prompt decode (recurring typos, kept for consistency)

"OREPARE"→prepare · "ORIME AGENT"→Prime Agent · "YSER"→user · "WIRKS OR NIT"→works
or not · "LIGIN"→login · "IR OAPER"→or paper · "UF"→if · "EHEN SWITCTCHING"→when
switching · "ENFIRCED"→enforced · "CIRRECT"→correct · "sox/Sox 0dte"→spx-0dte-bot
(V1) · "GOT 5.6 SOL"→GPT 5.6 SOL · "mats/mat skills"→MacBook-harness skill set.

## Already answered — do not redo

A prompt asking to challenge the Codex GPT 5.6 SOL analysis, inspect V1
coverage, challenge the rag/tot/cot/self-refinement instructions, and produce a
corrected input has arrived in **at least three sessions**. It is all delivered:

| Asked for | Where |
|---|---|
| Challenge the Codex audit | [`AUDIT_CHALLENGE_2026-08-28.md`](AUDIT_CHALLENGE_2026-08-28.md) §A, §B |
| V1 coverage verdict | same file **§C** — nothing essential is silently lost |
| Challenge the method instructions | same file **§D** |
| Corrected, agent-portable input | [`PRIME_AGENT_INPUT_SPX_V2.md`](PRIME_AGENT_INPUT_SPX_V2.md) |
| The three IBKR rules (decide-before-login, switch⇒reconnect, LIVE⇒realtime) | input §3 as **R1 / R2 / R3** — R1+R3 shipped in #284; R2 is S7 |

Redoing it is inventing work.
