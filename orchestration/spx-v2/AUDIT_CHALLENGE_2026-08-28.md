# Challenge of the "Codex GPT 5.6 SOL MAX ANALYSIS" — SPX 0DTE V2

> **Historical record, deliberately frozen.** This is a challenge of one dated
> analysis, verified against the repository as it stood on 2026-08-28. It is
> kept because [`PRIME_AGENT_INPUT_SPX_V2.md`](PRIME_AGENT_INPUT_SPX_V2.md)
> rests on its §B corrections, and because §C (V1 coverage) and §D (the method
> instructions) are still the answer when those questions are asked again.
> **Its repo-state claims are not current and are not maintained** — for that
> read [`STATE.md`](STATE.md), and above it, GitHub.


Date: 2026-08-28.
Verified against: `thomaswillner/spx-0dte-bot-v2` @ `cc7f8b1` (main, 2026-08-24),
`thomaswillner/spx-0dte-bot` (V1) @ `58a2aad`, plus the live GitHub issue tracker (90 open issues).
Method: fresh clones, file-level inspection, issue-body reads. No repo, runtime, scheduler,
browser, broker, or provider state was changed. Both SPX repos were attached read-only;
all writes live in `thomaswillner/prime-agent` (this orchestrating repo).

## Verdict on the audit

**The audit is substantially correct.** Its controlling classification
(`PAPER/OFF`, `NOT_PROD_READY`), its first blocker (Hermes→SPX session delivery missing),
its 0/12 certification finding, its GUI-split finding, and every issue number it cites
(#195/#196, #230, #236, #237/#255–#261, #171, #142) check out against the repository.
It contains **six imprecisions worth correcting**, **one framing error**, and it
**omits the three IBKR PAPER/LIVE requirements** the operator has since added. The
corrected input of record is [`PRIME_AGENT_INPUT_SPX_V2.md`](PRIME_AGENT_INPUT_SPX_V2.md).

## A. Claim-by-claim verification

| # | Audit claim | Verdict | Evidence |
|---|---|---|---|
| 1 | No PAPER or LIVE order has ever been placed | CONFIRMED | `CHANGELOG.md`: "the system has never placed a trade"; `VERIFICATION_MATRIX.md` §0 |
| 2 | Broker certification is 0/12 | CONFIRMED | `config/broker_paper_certification.yaml`: `status: incomplete`, all 12 scenarios `ok: false`; matrix §9 all `BLOCKED` |
| 3 | `session_store` absent from `origin/main`, not importable | CONFIRMED | `apps/server/spx_server/engine/session_wiring.py:252-288` imports module named by `SPX_SESSION_STORE_MODULE` (default `session_store`); no such module exists in the repo; #195: "does not exist anywhere in the repo or on the estate"; fails closed to `session_store_unavailable` |
| 4 | SPX reader expects one six-field contract object | CONFIRMED | `session_wiring.py:46-60` `PublishedSessionLike`: `domain, cookies, verified_at, age_s, ttl_s, source_profile`; `SESSION_READER_CONTRACT = 2`; typed `SessionUnavailable/SessionStale/SessionUnsafe`; freshness 900 s |
| 5 | Sanctioned PAPER order tool missing (#236) | CONFIRMED, sharpened | `Makefile:137` invokes `scripts/ibkr_order_poc.py` — the file does not exist in `scripts/`; #236 open, P1 |
| 6 | Four automation modes defined; shipped config resolves OFF | CONFIRMED (repo side) | `runtime.py:100-111` `AutomationMode{FULL_AUTO,SEMI_AUTO,MANUAL,OFF}`; `runtime.py:435` default OFF; shipped `config/data.yaml` has **no** `execution.mode` key and absence means off |
| 7 | Displayed mode can disagree with actual submission authority (#230) | CONFIRMED, sharpened | #230 measured live 2026-08-18: Mac-local `config/data.yaml` set `execution.mode: full_auto` (bot armed) while `/readiness`, `/state`, journal all reported `off` — display reads a never-assigned runtime field. Worse than "config resolves OFF": the deployed bot was armed with a lying display |
| 8 | Two independent axes: trading env × automation authority | CONFIRMED | `runtime.py:95-98` `TradingMode{PAPER,LIVE}` separate from `AutomationMode` |
| 9 | CBOE currently influences intraday decisions | CONFIRMED, reframed | See B.1 — it is a recorded operator decision, not a drift defect |
| 10 | GUI split: `spx-gui` Trade-only real app vs comprehensive fixture demo | CONFIRMED | `apps/gui/spx_gui/app.py` + `demo.py` + `fixtures.py`; matrix UI-01 (source exists) vs UI-02…UI-08 all "Unmounted; fixture-backed" FAIL; #237/#255–#261 open |
| 11 | Issues #195/#196, #230, #236, #237/#255–#261 open | CONFIRMED | Live tracker, all open, labels match |
| 12 | Recent main broker fixes (reconnect re-subscription etc.) | CONFIRMED | HEAD `cc7f8b1` = "fix(broker): re-subscribe account updates after a physical reconnect (#240)" |
| 13 | Fail-closed defaults, one order owner, broker-resident protection, typed refusals | CONFIRMED | `CHANGELOG.md` engine/broker sections; `engine/order_lifecycle.py` single decision-to-broker path; OCA exits; 21 named pricing refusals |
| 14 | Mode-switch state machine unbuilt | CONFIRMED | #44: "POST /mode can only 403 or 409. No quiesce, prove-flat, rebind, arm, rollback"; matrix MODE-06 FAIL, MODE-09: runtime `trading_mode` reload refused (409), mode pinned for process lifetime; T19 named future owner |
| 15 | V2-not-V3 convergence recommendation | CONFIRMED as conclusion | The repo is one integrated monorepo with protocol, gates, ledgers; duplication cost is real. The 24/25 vs 8/25 vs 9/25 scores are subjective scaffolding — keep the conclusion, drop the pseudo-precision |
| 16 | ib_async 2.1.0 / PySide6 6.11.1 / PyYAML 6.0.3 | CONSISTENT, runtime-side | Repo pins are ranges (`ib_async>=1.0.3`, `PySide6>=6.11`, `pyyaml>=6.0`) + macOS lockfile; matrix cites "pinned ib_async==2.1.0". Exact installed versions are Mac-runtime facts |

## B. Corrections to the audit

1. **CBOE framing (audit §11).** The audit calls CBOE's intraday authority "a specification
   and code defect." It is not a defect: `docs/v2/DECISIONS_LOG.md` row 2026-07-26 is an
   **operator decision** — "CBOE's public option chain is the approved open-interest source,
   making max pain a measurement and arming `skip_if_gex_maxpain_diverge_pts`." Per the repo's
   authority order (`AGENTS.md` §6: decisions log > KNOWN_BUGS > code/tests > issues), the
   operator's new EOD-only instruction **supersedes** that row and must be recorded as a new
   decision-log entry before code changes. Helpfully, the mechanism is cheap:
   `spx_core/strategy/settings.py:27` already marks the divergence gate **INERT when max pain
   is proxy-sourced**, so reverting max pain to the measured Tradytics proxy re-inerts the
   gate without touching gate code. The composition seam to remove is
   `CboeOpenInterestSource` in `spx_datahub/providers.py:604-860` plus the `cboe_delayed`
   entries in proxy chains (`providers.py:237-239`).
2. **"Shipped configuration resolves to OFF" (audit §4)** is true of the repository default
   only. The **deployed Mac config was measured `full_auto`** (#230). Any corrected input must
   treat "set the runtime config's `execution.mode` explicitly to `off` until #230 is fixed
   and the first supervised order is authorized" as an immediate safety action, not a given.
3. **`SPX_SESSION_ARTIFACTS_DIR/<domain>.json` and the "0600 artifact" (audit §3/§5/§8)**
   appear nowhere in the repo. They are Codex's *proposal*, not the existing contract. The
   real, code-verified seam is: module import via `SPX_SESSION_STORE_MODULE`
   (`session_wiring.py:258`), contract v2, six fields, 900 s freshness. Artifact directory,
   file naming, and permissions are **open operator decisions** (the audit's own §18 admits
   this for the directory). The corrected input carries them as decisions D1 with a proposed
   default, not as established fact.
4. **MANUAL/SEMI_AUTO "blur" (audit §4)** is an implementation gap, not doctrinal confusion:
   doctrine already separates them (T12 mode rules; T13 manual-open pipeline, specced in
   #78–#85, unbuilt — matrix MODE-05 FAIL). Today MANUAL can only approve retained bot-built
   cards (MODE-04) *because* manual-open does not exist. The fix is to build #78–#85, not to
   re-litigate doctrine.
5. **Hermes-side claims** (cookie-array + sidecar format, `AGENTIC_*` paths, job
   `3ad1f54ae452` @ 10 min, all four provider checks passing) are **not verifiable from the
   repositories** — Hermes lives on the Mac estate (sole repo mention: one comment in
   `.env.example:119`). They are accepted as operator-supplied receipts and must be re-proven
   by the runtime-identity slice (S0) and the delivery slice (S1) before anything depends on
   them.
6. **Mac-runtime claims** — SPX server not running, 43 worktrees, `.venv` importing stale
   `wt-auto-153` — same status: plausible (the repo says the system was never deployed;
   `docs/agents/worktrees.md` documents a worktree-heavy process), unverifiable from here,
   re-proven in S0.
7. **Omission:** the audit's §18 "decisions needed later" misses the three operator
   requirements added 2026-08-28 (PAPER/LIVE decision before IBKR login; forced reconnect on
   GUI switch; real-time enforcement on LIVE). These are now binding requirements R1–R3 in
   the corrected input, with the verified partial foundations listed there.

## C. V1 coverage verdict (audit asked; operator asked)

**Nothing essential from V1 is silently lost.** Evidence:

- V2 carries an authoritative 300-line V1 synthesis: `docs/v2/V1_SYSTEM_MAP.md`
  (complete rule set §4, data/trust model §5, execution lifecycle §6, go-live chain §9,
  ten named debt items §10).
- Carried into V2 code or scripts: strategy gate chain (15 gates, one pipeline), GEX core,
  sizing/exits/structures, circuit-breaker concept, journal design, alerts package,
  supervisor (`ops/supervisor/`), go-live chain of trust
  (`scripts/go_live.sh`, `go_live_launcher.py`, `verify_live_*`, `compute_live_token.py`),
  12-scenario certification file, per-mode ports/accounts config.
- Tracked as open work, not lost: dashboard's 8 tabs → GUI views 2–8 (#237/#255–#261),
  manual pipeline (#78–#85), `/phase` provider (#45), mode-switch machine (#44/T19),
  replay/backtest rigor (matrix ROBUST-01/02).
- Deliberately eliminated, by design: the ~10k-line simulated-input login machinery
  (V1 map §7) — banned by `AGENTS.md` §2.1 and a CI gate.
- Prior art for the new CBOE rule: **V1's `cboe_eod`** was exactly a once-daily
  close-capture divergence check (>20% or >50 pts → breaker). The operator's EOD-only
  instruction restores CBOE to its V1 role; V2's 2026-07-26 decision was the departure.
- V1 repo remains legacy/frozen for development (V2 `CHANGELOG.md`: "v2 is a from-scratch
  rebuild; the inherited v1 history is not carried forward"); referencing the V1 repo path
  inside V2 is CI-blocked (`check_no_v1_references.sh`). Do not develop in V1.

## D. Challenge of the prompt instructions ("You must use rag and tot and cot and self refinement … mats skills and superpower skills")

Verdict: **partially non-compliant as written; workable once made concrete.** For any
strong reasoning agent (GPT 5.6 SOL under Codex, Prime Agent, Claude):

1. **"RAG"** — workable only with a named corpus and budget. The Codex session itself logged
   a "missing retrieval budget" and a "noisy Hermes search" as self-refinement findings.
   Corrected form: retrieval corpus = the V2 repo, its issue tracker, `DECISIONS_LOG.md`,
   `KNOWN_BUGS.md`, the readiness ledgers; exact-path reads over broad search; cite
   `file:line`; respect the authority order (an issue is the weakest source).
2. **"ToT"** — unbounded tree-of-thought burns tokens for no auditability. Corrected form:
   bounded alternatives (≤3 options, explicit criteria, one recommendation) **only** for
   named open decisions, recorded in a superpowers plan/spec doc. The V2-vs-V3 comparison is
   the template.
3. **"CoT"** — reasoning models reason internally; raw chain-of-thought is not exposed and
   must not be demanded as output (the audit's §15 already concedes this). Corrected form:
   the *auditable decision rationale* goes in the plan/spec/PR body; private reasoning stays
   private.
4. **"Self refinement"** — compliant and already a repo convention: append errors and
   corrections to `.learnings/ERRORS.md` and `.learnings/LEARNINGS.md` in the V2 repo so
   future sessions do not repeat them. The instruction should name those files (it did not).
5. **"mats skills"** — exist **on the MacBook harness** (operator-confirmed 2026-08-28,
   correcting this session's initial overclaim of nonexistence). They are not present in
   the V2 repo, the V1 repo, this repo, or this remote session's skill roster — and a
   remote cloud session cannot see the MacBook-local harness (`~/.claude/skills`, local harness
   skills, Codex harness config), so repo/remote absence proved nothing about the estate.
   Consequence: "invoke mats skills" is executable only by an agent running **on the
   MacBook harness**. The corrected input routes them conditionally: a MacBook-local agent
   enumerates its harness skills at session start and routes through mats wherever it
   applies (S0 records the harness skill inventory as part of runtime identity); a remote
   agent states it cannot reach them and uses the repo conventions alone.
6. **"superpower skills"** — exist in **two layers**: a MacBook-harness skill set
   (operator-confirmed, same visibility caveat as above) and the V2 repo's SDD convention
   (`.superpowers/`, `docs/superpowers/{plans,specs}`: plan + spec before implementation).
   The repo convention is the portable projection every agent must satisfy — committed
   plan/spec artifacts are what reviewers and future sessions can see — and a
   MacBook-local agent additionally invokes the harness superpowers skills that
   generate/enforce them. (In this remote verification session, the genuinely relevant
   enabled skills — `trading-intelligence` — were loaded; `project-tracker` was evaluated
   and skipped: its project list contains no SPX entry.)

Bottom line: instructions rewritten as the **Method contract** in
[`PRIME_AGENT_INPUT_SPX_V2.md`](PRIME_AGENT_INPUT_SPX_V2.md) §7. That form is executable by
GPT 5.6 SOL, Prime Agent, or any comparable agent, because every demand is expressed as
files to read, files to write, and rules to obey — not as vendor-specific tool names.
