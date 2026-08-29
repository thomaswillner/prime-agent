# SPX V2 — Implementation Input of Record (corrected, evidence-anchored)

> **Status banner (2026-08-29, `main` `8d2139c`).** This document is the
> **input of record** and still governs: the mission, the guardrails (§8), the
> forbidden list (§9) and the open decisions (§10) are all live. But its §2
> "ground truth" describes the repository **as measured on 2026-08-28**, and
> several defects it names are now fixed. **Slices S0, S1, S2 and S3 of §5 are
> merged**; S4 (#236) is next and needs decision D3. For what is true today read
> [`STATE.md`](STATE.md) — and above either of them, read GitHub.


Date: 2026-08-28. Status: **supersedes** the pasted "Codex GPT 5.6 SOL MAX ANALYSIS" as the
input handed to the implementing agent. Corrections applied per
[`AUDIT_CHALLENGE_2026-08-28.md`](AUDIT_CHALLENGE_2026-08-28.md).

Audience: the implementing coding agent — Prime Agent, GPT 5.6 SOL (Codex), or equivalent.
Everything here is expressed as files to read, files to write, commands to run, and rules to
obey, so it is agent-portable. Repo facts were verified at
`thomaswillner/spx-0dte-bot-v2` @ `cc7f8b1` (2026-08-24).

---

## 1. Mission

Converge `spx-0dte-bot-v2` (V2, on GitHub `origin/main` — the single source of truth) into a
**provably working PAPER trader**, then keep it there. The **operator runs the runtime** on
the Mac and supplies the proof (paper fills, receipts); the agent prepares every command,
config, and evidence capture so those runs succeed or refuse with a named reason.
LIVE trading is a **separate, later qualification** that only the operator triggers.

Controlling classification until proven otherwise: `PAPER/OFF` — `NOT_PROD_READY`.

Non-goals (forbidden, see §9): V3, rewrites, new architecture, new session refreshers,
work not traceable to this document or a named open issue.

## 2. Ground truth (verified 2026-08-28)

Three evidence classes — treat them differently:

**(a) Repo-verified facts** (act on directly):
- Delivery seam absent: `apps/server/spx_server/engine/session_wiring.py:252-288` imports a
  module named by `SPX_SESSION_STORE_MODULE` (default `session_store`) which exists nowhere;
  discovery fails closed → `/readiness` reports `session_store_unavailable` for both domains
  (#195/#196/#171). Contract the module MUST satisfy (verified at import, mismatch fails
  closed): `SESSION_READER_CONTRACT = 2`; callable `SessionStore` factory; instance
  `read(domain, *, max_age_s)`; typed exceptions `SessionUnavailable`, `SessionStale`,
  `SessionUnsafe`; publications expose exactly `domain, cookies, verified_at, age_s, ttl_s,
  source_profile`; freshness budget 900 s; domains `tradytics`, `tradingview`.
- Zero orders ever; broker certification 0/12 (`config/broker_paper_certification.yaml`
  `status: incomplete`, all `ok: false`); the sanctioned order tool `scripts/ibkr_order_poc.py`
  referenced by `Makefile:137` **does not exist** (#236).
- Mode truth defect #230: submission path resolves `execution.mode` live (correct); display
  path (`/readiness`, `/state`, journal, GUI strip) reads a never-assigned runtime field
  initialized OFF. Measured on the Mac 2026-08-18: config `full_auto`, display `off`.
- Two independent axes: `TradingMode{PAPER,LIVE}` and
  `AutomationMode{FULL_AUTO,SEMI_AUTO,MANUAL,OFF}` (`runtime.py:95-111`); repo default
  resolves OFF (shipped `config/data.yaml` has no `execution.mode`; absence = off, and a
  deliberate test pins that default — do not touch it).
- PAPER/LIVE binding already config-first: `config/account.yaml` `trading_mode: paper|live`
  selects port (7497/7496) and account (`DU…`/`U…`); the mode is resolved once at process
  composition and **runtime `trading_mode` changes are refused** (409; matrix MODE-09);
  the mode-switch state machine is entirely unbuilt (#44/T19: no quiesce, prove-flat,
  rebind, arm, rollback).
- `spx_broker/session.py` `SessionReadinessGate`: authenticated-session + account-identity
  match + trade-ready probe; `PAPER_ACCOUNT_PATTERN ^DU[A-Z0-9]+$`,
  `LIVE_ACCOUNT_PATTERN ^U[A-Z0-9]+$`; invalidated on every reconnect; fail-closed.
- `spx_broker/ib_gateway.py` market-data-type machinery: desired-type tracking with
  re-apply after reconnect (`:1633`, `:2054-2057`); `request_paper_market_data_type()`
  (delayed=3) **refuses when live orders are armed** (`:2033-2036`); live path applies
  `reqMarketDataType(1)` (`:2117-2130`); IBKR error 10186 (delayed where live required) is a
  typed refusal `market_data_delayed` (`:466-472`). Open defect #165: 10186 unclassified in
  the model-IV reducer, so accepted realtime IV can survive a delayed downgrade.
- CBOE is intraday today **by recorded operator decision** (`docs/v2/DECISIONS_LOG.md`
  2026-07-26): approved OI source, max pain "measured", divergence gate armed;
  `CboeOpenInterestSource` composed in `spx_datahub/providers.py:604-860`, `cboe_delayed`
  in proxy chains (`providers.py:237-239`). The gate auto-INERTs when max pain is
  proxy-sourced (`spx_core/strategy/settings.py:27`).
- GUI: one real app (`apps/gui/spx_gui/app.py`, Trade view, real API/WS) + one fixture demo
  (`demo.py`); views 2–8 unbuilt in production (#237, #255–#261); five chart routes lack a
  `MarketDataPort` implementation (#97).
- Money-path bugs open and prerequisite to certification: #116, #117, #119, #121, #122,
  #123, #126 (and the rest of `docs/KNOWN_BUGS.md` P0/P1 rows).
- Governance: authority order = `docs/v2/DECISIONS_LOG.md` > `docs/KNOWN_BUGS.md` >
  code+tests > GitHub issues (`AGENTS.md` §6). Session protocol: `make preflight`, then
  `make open-work`; claims via one issue → one branch `fix/<n>-slug` → own worktree → draft
  PR (`docs/agents/COORDINATION.md`, `docs/agents/worktrees.md`).

**(b) Operator receipts (Mac estate; accepted, must be re-proven in S0/S1 before depended on):**
Hermes refresher passing every 10 min (job `3ad1f54ae452`); all four provider checks green
(Google/X identity match, TradingView streaming fresh, Tradytics premium ok); IB Gateway
listening on 7497; installed `ib_async 2.1.0`, `PySide6 6.11.1`, `PyYAML 6.0.3`; SPX server
not running; ~43 worktrees; `.venv` resolving code from stale worktree `wt-auto-153`.

**(c) Codex proposals (NOT existing contracts — adopt only via §10 decisions):**
`SPX_SESSION_ARTIFACTS_DIR/<domain>.json` path scheme; `0600` artifact permissions; the
"one atomic SPX contract artifact" publication format. The only fixed thing is the consumer
contract in (a).

## 3. Binding operator decisions (2026-08-28)

Carried from the audit, all re-confirmed: real PAPER trading is the proof; operator chooses
PAPER duration; operator authorizes LIVE cutover; delayed PAPER data allowed when typed and
visible; LIVE option execution data comes real-time from IBKR; TradingView + Tradytics stay
required; **Hermes remains sole refresh owner** (no second refresher/browser owner/cookie
reader in SPX); SEMI_AUTO requires human approval; MANUAL and FULL_AUTO stay selectable;
one production GUI; **converge V2 — no V3**.

**New and binding — the three IBKR PAPER/LIVE rules:**

- **R1 — Decide before login.** The PAPER-vs-LIVE decision must be resolved **before** any
  IBKR API connection, because account numbers differ. Concretely: the process binds
  `trading_mode` → port + account at composition (exists); on connect, the reported
  account must match both the configured account **and** the mode's account class
  (`DU…` ⇔ paper, `U…` ⇔ live) or the session refuses with a typed reason surfaced in
  `/readiness` and the GUI (extend `SessionReadinessGate` usage; add the account-class
  cross-check at startup if absent). No order path arms before this proof.
- **R2 — Switch ⇒ reconnect.** A GUI/API switch PAPER↔LIVE must force a full IBKR
  disconnect and reconnect against the target mode's port + account; silent in-process
  account reuse is forbidden. Because mode is pinned per process lifetime (MODE-09) and the
  switch machine is unbuilt (#44/T19), the compliant sequence is: quiesce entries → prove
  flat → persist target mode → **stop and restart the engine process** (or execute T19's
  rebind once built) → reconnect → R1 re-proof (readiness gate invalidates on reconnect —
  exists) → only then re-arm. Until T19 ships, the GUI must present the switch as this
  supervised restart flow with explicit states, never as a toggle that silently succeeds;
  `POST /mode` keeps refusing anything else.
- **R3 — LIVE ⇒ real-time enforced.** Whenever the effective trading mode is LIVE:
  `reqMarketDataType(1)` on connect and re-applied after every reconnect (exists);
  delayed data (10186 / reported type ≠ 1) is a hard typed refusal on entry paths
  (`market_data_delayed` — exists at the adapter; **fix #165** so no reducer keeps stale
  realtime values past a downgrade); `request_paper_market_data_type()` must remain
  refused in live (exists); add a live-mode assertion that the *observed* (callback-reported)
  data type is 1 before any entry authorization.

**CBOE — EOD only (supersedes DECISIONS_LOG 2026-07-26).** CBOE must never influence
intraday decisions. First PR of slice S2 appends the superseding decision row to
`docs/v2/DECISIONS_LOG.md`, then: max pain reverts to the measured Tradytics proxy
(divergence gate auto-INERTs per `settings.py:27`), `CboeOpenInterestSource` and
`cboe_delayed` proxy links leave intraday composition, and CBOE data feeds **only** an
after-close divergence report into audit/quality storage (never DataHub elements, never
strategy gates). V1's `cboe_eod` (once-daily close capture; >20 % or >50 pts alarm) is the
prior-art spec; the exact formula and zero-handling are decision D2.

## 4. Intended flow (corrected)

```
Hermes (sole refresh owner, Mac estate)
  -> atomic per-domain publication (format per D1)
  -> `session_store` module satisfying the verified reader contract (S1)
  -> RuntimeSessionLoader (fail-closed; 900s; typed refusals)      [exists]
  -> authenticated Tradytics/TradingView clients                    [exists]
  -> typed data: source/mode/age/quality/refusal                    [exists]
  -> strategy 15-gate pipeline, risk, max-loss sizing               [exists]
  -> OFF | MANUAL | SEMI_AUTO | FULL_AUTO (one truth surface, #230)
  -> final authorization (30s budget, durable persist)              [exists]
  -> IBKR PAPER combo via the ONE order owner + OCA protection      [exists, unproven]
  -> fills / reconciliation / journal                               [exists, buggy: KNOWN_BUGS]
  -> one live PySide6 GUI (Trade + views 2-8)                       [Trade only]

After close only: provider observations -> CBOE comparison -> % divergence report (S2)
```

PAPER may use approved delayed/proxy data when typed and visible. LIVE requires
broker-reported real-time quotes/Greeks/IV from IBKR (R3).

## 5. Work plan — ordered slices, each mapped to real issues

Execute in order; each slice = superpowers plan+spec, one issue, one branch, one worktree,
one draft PR, validated before push. Do not start a later slice while an earlier one's
refusal is unexplained.

- **S0 — Runtime identity + truth.** Build a deterministic runtime whose imports resolve
  exactly current `origin/main` (fresh worktree + fresh `.venv` via `make v2-install`;
  record commit, tree, interpreter, and package origins into a startup identity report
  exposed on `/readiness`; additionally inventory the MacBook harness skills — mats,
  superpowers, and the rest — into the S0 plan so later slices route through them
  deliberately). Fix **#230** (one accessor; display = submission truth; keep the
  shipped-default-off pin untouched). Safety action for the operator, documented in the PR:
  set the Mac config's `execution.mode: off` explicitly until S4. Exit: operator starts SPX
  in `PAPER/OFF`; `/readiness` shows real build identity, honest mode, and the two session
  domains failing closed with `session_store_unavailable` (expected until S1).
- **S1 — Hermes→SPX session delivery** (#195, #196, #171; respect #153 provider-owned
  recovery). Implement the `session_store` module against the contract in §2(a) plus the
  Hermes-side publisher mapping (atomic write, per-domain, path/naming per decision D1 —
  propose a default in the plan, get the operator's sign-off in the PR). Hermes stays the
  only writer; SPX only reads. Exit (from #195/#196 acceptance): `/readiness` shows both
  domains healthy with real cookie age + verification time; stale artifact → stale (test
  that fails before the change); malformed/absent → fail-closed, no third-party exception
  text; **verified against the live runtime, not only unit tests**.
- **S2 — CBOE EOD-only** per §3. Exit: no CBOE symbol in any intraday composition/import
  path (grep-provable), divergence gate INERT under proxy max pain, EOD report lands in
  audit/quality storage, superseding decision row merged.
- **S3 — R1/R3 hardening.** Account-class cross-check at connect (R1) surfaced in
  `/readiness` + GUI; live data-type observed==1 assertion + **#165** fix (R3). (R2's full
  machine is S7; S3 only guarantees nothing silently switches today: `POST /mode` still
  refuses, and mismatches refuse loudly.)
- **S4 — Sanctioned PAPER order tooling + first bounded order** (#236, matrix PAPER-01).
  Implement `scripts/ibkr_order_poc.py` (place/verify/cancel) **through the production
  adapter, order owner, and journal — no private broker shortcut** (matrix rule). Then, under
  explicit operator run authorization, one bounded PAPER order (scenario/window per D3);
  capture evidence into `docs/readiness/` and flip PAPER-01 with receipts.
- **S5 — Money-path prerequisites + 12-scenario certification** (#142; bugs #116, #117,
  #119, #121, #122, #123, #126 and remaining P0/P1 `KNOWN_BUGS` rows first). Execute
  PAPER-01…12 on one exact candidate; update `config/broker_paper_certification.yaml` only
  with real IBKR paper evidence.
- **S6 — One production GUI** (#237, #255–#261, #97; plus GUI defects #214–#227 as they
  block usability). Real views 2–8 in the live app; demo/replay becomes a mode of the same
  app; multiple windows only as instances of it (#227). Charts get full pages/splitters;
  readable typography; expandable evidence panels.
- **S7 — Mode-switch state machine** (T19/#44) implementing **R2** end-to-end with GUI
  states (quiesce → prove-flat → rebind/restart → reconnect → R1 re-proof → arm), plus
  rollback. Until merged, the GUI switch remains the supervised restart flow.
- **S8 — Supervised PAPER soak** in SEMI_AUTO → MANUAL (needs #78–#85 for manual-open) →
  FULL_AUTO for the operator's chosen duration (D4); then LIVE qualification as a separate
  effort (phase provider #45, `scripts/go_live.sh` chain, entitlements D7) — **only when the
  operator decides**.

## 6. Runtime proof protocol (operator-executed)

For every slice the agent delivers: (1) exact commands the operator runs on the Mac,
(2) expected `/readiness`/GUI observables for success **and** for each named refusal,
(3) where evidence lands (`docs/readiness/`, journal, certification YAML). The agent never
claims runtime success it did not observe; "code-wired" and "runtime-proven" stay distinct
states, as in `docs/readiness/VERIFICATION_MATRIX.md` — which must be updated with each
slice's real evidence.

## 7. Method contract (replaces "use rag and tot and cot and self refinement / mats and superpower skills")

- **Retrieval (RAG):** corpus = the V2 repo at current `origin/main`, its issue tracker,
  `DECISIONS_LOG.md`, `KNOWN_BUGS.md`, `docs/readiness/*`, `docs/agents/*`. Prefer
  exact-path reads over broad search; cite `file:line`; budget retrieval per task; the
  authority order of `AGENTS.md` §6 resolves conflicts (an issue is the weakest source).
- **Bounded alternatives (ToT):** only for named open decisions (§10): ≤3 options, explicit
  criteria, one recommendation, recorded in the slice's superpowers plan. No unbounded
  exploration.
- **Reasoning (CoT):** private. The auditable artifact is the plan/spec/PR rationale —
  assumptions, alternatives, evidence, tests — never raw chain-of-thought.
- **Self-refinement:** every error made and corrected during implementation is appended to
  `.learnings/ERRORS.md` / `.learnings/LEARNINGS.md` in the V2 repo (existing convention)
  in the same PR when repo-relevant; session-scoped notes live in the orchestration repo.
  Future sessions read these before starting.
- **Harness skills (mats + superpowers) and the repo's SDD process:** the "mats" and
  "superpowers" skill sets live **on the MacBook harness** (operator-confirmed 2026-08-28;
  invisible from remote sessions — they are not in the repos). An agent running on the
  MacBook MUST enumerate its local harness skills at session start and route work through
  the mats and superpowers skills wherever they apply; a remote agent states that it cannot
  reach them and uses the repo conventions alone. Portable floor for every agent, harness
  skills or not: for each slice write `docs/superpowers/plans/<date>-<slug>.md` and, where
  design is non-trivial, `docs/superpowers/specs/<date>-<slug>-design.md`, before
  implementation — the existing fourteen plans are the format reference. Committed
  artifacts are the proof; a harness-skill run that leaves no repo artifact does not count.
- **Drift control:** at each iteration boundary, check work against §1 (mission), §5
  (current slice), §9 (forbidden). On drift: stop, record in the session learnings file,
  return to the slice. When the slice's exit criteria are met: **stop**, report changes, and
  list any discovered out-of-scope items as proposals — do not do them.

## 8. Guardrails (non-negotiable, from the V2 repo's own law)

- `AGENTS.md` §2 hard rules: never simulate mouse/keyboard/accessibility input; never
  reference the v1 repository path (CI-gated); never fabricate a value; freshness only from
  a MEASURED source mode; never handle credentials (IBKR login is operator-owned via IBC);
  time is injected, never ambient.
- Session start: `make preflight`, `make open-work` (treat output as a strong hint, not an
  oracle — #110). Claim before edit; draft PR = the claim. Never `git stash`,
  `git checkout --`, `git reset --hard`, `git clean` on a shared checkout.
- Validation before push: the repo's own lanes (`make v2-test`, gate self-tests, help
  coverage — see `AGENTS.md` §3); a new runtime module registers in
  `config/acceptance-gates.toml`, a new test file in `config/test-lanes.toml` (§4).
- Cookies and quote tokens stay backend-only: never in logs, journal, runtime state,
  `/ws/events`, API or GUI payloads (matrix #128 boundary).
- PAPER account only; `SPX_BOT_ENABLE_LIVE_ORDERS=0`; nothing in S0–S7 touches a live
  account, live port 7496, or live entitlements.
- `KNOWN_BUGS.md` rows move to §Fixed with the closing commit — never deleted.

## 9. Forbidden work (inventing scope is a failure)

No V3 / rewrite / framework migration. No second session refresher, browser owner, or
cookie reader inside SPX. No CBOE intraday resurrection. No certification shortcut around
the production adapter/journal. No live-trading work beyond S8's named qualification prep.
No drive-by refactors, doc sweeps, or GUI polish outside the named issues. No edits to V1.
No changes to the shipped-default-off mode pin. Anything not traceable to §5 or a named
open issue requires the operator's explicit approval first.

## 10. Open operator decisions (block only their own slice)

| ID | Decision | Blocks | Proposal duty |
|---|---|---|---|
| D1 | Session artifact directory, naming, permissions (e.g. per-domain JSON, `0600`, atomic rename) | S1 | Agent proposes in S1 plan; operator signs off in PR |
| D2 | Exact CBOE EOD divergence formula + zero/absent handling (V1's >20 % / >50 pts as starting point) | S2 report | Agent proposes |
| D3 | First PAPER order: structure, scenario, time window | S4 | Agent proposes 2–3 bounded options |
| D4 | PAPER acceptance duration + SEMI/MANUAL/FULL sequence lengths | S8 | Operator states |
| D5 | Provider continuity SLO / retry / alert thresholds | S1 hardening | Agent proposes |
| D6 | Final MANUAL UX (ticket flow, #78–#85 scope cut) | S8 | Agent proposes |
| D7 | Measured IBKR professional LIVE data entitlements | LIVE qualification | Operator obtains |
| D8 | One-window vs optional multi-window instances of the one GUI | S6 | Agent proposes |

---

**Definition of done for this input:** slice S5 complete (12/12 with real evidence) and an
operator-confirmed PAPER soak running per D4 — everything after that is LIVE qualification,
which starts only on the operator's explicit word.
