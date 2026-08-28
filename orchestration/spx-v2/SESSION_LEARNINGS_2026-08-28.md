# Session learnings — SPX V2 audit challenge, 2026-08-28

Self-refinement record of the verification session that produced
[`AUDIT_CHALLENGE_2026-08-28.md`](AUDIT_CHALLENGE_2026-08-28.md) and
[`PRIME_AGENT_INPUT_SPX_V2.md`](PRIME_AGENT_INPUT_SPX_V2.md).
Purpose: future sessions read this file first and do not repeat these mistakes.

## Errors and corrections made in this session

1. **Wrong first hypothesis about "superpower skills".** Initially treated it as a possible
   agent-plugin skill and searched the enabled-skill roster (no match). Correction: it is the
   V2 repo's own spec-driven-development convention (`.superpowers/`,
   `docs/superpowers/{plans,specs}`). Lesson: when a prompt names a capability, search the
   *target repo* for it before concluding anything from the agent's own tooling.
2. **Too-narrow grep gave a false near-absence.** Grepping `FULL_AUTO|SEMI_AUTO` under
   `packages/` only returned `spx_journal/models.py`, which would have wrongly located the
   mode enum. Correction: widened to `apps/` and found the authoritative enum in
   `apps/server/spx_server/runtime.py:100`. Lesson: in this monorepo, runtime authority
   lives under `apps/server/`, domain libraries under `packages/` — search both before
   claiming absence.
3. **Two audit "facts" were actually proposals.** `SPX_SESSION_ARTIFACTS_DIR/<domain>.json`
   and the `0600` artifact rule appear nowhere in the repo; the real contract is the
   `SPX_SESSION_STORE_MODULE` import in `session_wiring.py:252-288`. Correction recorded in
   the challenge doc §B.3 and carried as open decision D1. Lesson: verify every path/name an
   upstream analysis presents as existing before building against it.
4. **"Shipped config resolves OFF" needed splitting.** Repo default OFF (no `execution.mode`
   key, pinned by test) is true; the deployed Mac config was measured `full_auto` with a
   lying display (#230). Correction: both facts stated separately; runtime config must be
   set `off` explicitly until #230 lands (input doc S0). Lesson: "shipped" and "deployed"
   are different identities in this project — always name which one.
5. **CBOE reframing.** Nearly repeated the audit's "defect" framing; the intraday CBOE role
   is a recorded operator decision (`DECISIONS_LOG.md` 2026-07-26). Correction: the fix path
   is a superseding decision row first, then code; the divergence gate auto-INERTs under
   proxy max pain (`settings.py:27`). Lesson: check `DECISIONS_LOG.md` before calling any
   behavior a defect — it is the top authority in this repo.

## Interpretation map for the operator's prompt (typo decode, kept for consistency)

"OREPARE"→prepare · "ORIME AGENT"→Prime Agent · "YSER"→user · "WIRKS OR NIT"→works or not ·
"LIGIN"→login · "IR OAPER"→or paper · "UF"→if · "EHEN SWITCTCHING"→when switching ·
"ENFIRCED"→enforced · "CIRRECT"→correct · "sox/Sox 0dte"→spx-0dte-bot (V1) ·
"GOT 5.6 SOL"→GPT 5.6 SOL · "mats skills"→nonexistent (struck; operator to define if meant).

## Verified-fact anchors (do not re-derive; re-verify only if HEAD moved)

- V2 verified at `cc7f8b1` (2026-08-24); V1 at `58a2aad`. Issues checked 2026-08-28 (90 open).
- Key anchors: `session_wiring.py:252-288` (missing `session_store`),
  `Makefile:137` → missing `scripts/ibkr_order_poc.py` (#236),
  `runtime.py:95-111`/`:435` (modes, OFF default), `session.py` (DU*/U* identity gate),
  `ib_gateway.py:2033-2130` (data-type enforcement), `providers.py:604-860` (CBOE intraday),
  `broker_paper_certification.yaml` (0/12), `VERIFICATION_MATRIX.md` (MODE-06/09, PAPER-01..12).

## Instructions for future sessions

1. Read `PRIME_AGENT_INPUT_SPX_V2.md` first; it supersedes the pasted Codex audit. Then
   `git fetch` and diff V2 `origin/main` against `cc7f8b1` — re-verify only what moved.
2. Follow the V2 repo protocol before touching anything: `make preflight`,
   `make open-work`, claim via draft PR, own worktree per issue.
3. Write implementation-time errors/corrections into the V2 repo's `.learnings/ERRORS.md`
   and `.learnings/LEARNINGS.md` (existing convention), not only here.
4. Never develop in the V1 repo; never reference the v1 path inside V2 (CI gate).
5. Mac-runtime claims (Hermes health, worktrees, venv provenance, server state) are
   operator receipts — re-prove at runtime (input doc §6); never treat them as repo facts.
6. Do not invent scope: every change traces to input-doc §5 or a named open issue;
   discovered extras are reported as proposals, not done.
