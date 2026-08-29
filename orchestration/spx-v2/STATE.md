# SPX V2 — current state

**GitHub is the source of truth. This file is a pointer, not an authority.**
If it disagrees with `thomaswillner/spx-0dte-bot-v2`, GitHub is right and this
file is stale — fix it in the same session that noticed.

Last reconciled against `main` **`8d2139c`**, 2026-08-29 22:00Z.

## Convergence plan status

Slices are defined in [`PRIME_AGENT_INPUT_SPX_V2.md`](PRIME_AGENT_INPUT_SPX_V2.md) §5.

| Slice | Scope | State |
|---|---|---|
| S0 | Runtime identity + mode truth (#230) | merged |
| S1 | Hermes→SPX session delivery (#195/#263, hardened #265/#269) | merged |
| S2 | CBOE EOD-only (#264/#270) | merged |
| S2b | TradingView VIX3M is PAPER-only (#272/#273) | merged |
| S3 | R1/R3 broker hardening + #165 (#271/#284) | merged |
| **S4** | **Sanctioned PAPER order tooling (#236), then one bounded PAPER order** | **next — needs decision D3** |
| S5–S8 | Certification, GUI, mode-switch machine, PAPER soak | not started |

**Everything merged so far is code-wired, not runtime-proven.** Broker
certification is `0/12` and this system has never placed a trade. S4 is the
first slice whose exit criteria require a real broker order.

## What only the operator can do

1. **Start the runtime on the Mac.** No cloud session can: the only Claude Code
   environment is `anthropic_cloud` (Linux), with no route to the Mac and no
   IB Gateway. **First attempt made 2026-08-30 — [thomaswillner/spx-0dte-bot-v2#291](https://github.com/thomaswillner/spx-0dte-bot-v2/pull/291), evidence only.** It
   did not pass: with IB Gateway down the PAPER runtime fail-closes at adapter
   start (`paper_adapter_session_check_failed`) and never binds, so `/readiness`
   was never presented. Two measured FAILs (session artifacts absent →
   `artifact_missing` both domains; no listener on 7497), three observables
   unprovable without a live process.

   **Three preconditions, all required — the Gateway alone is not enough:**
   1. **IB Gateway running on 7497.** Installed as of 2026-08-30 (operator);
      supervision is [thomaswillner/spx-0dte-bot-v2#292](https://github.com/thomaswillner/spx-0dte-bot-v2/pull/292) plus issue
      [#249](https://github.com/thomaswillner/spx-0dte-bot-v2/issues/249), not a hand-start.
   2. **Hermes publishing the session artifacts.** Observable (c) failed
      `artifact_missing` on BOTH domains, and no amount of Gateway uptime fixes
      that — the artifacts come from the Hermes→SPX publisher, which is not
      deployed (decision D1 territory). Without this, (c) fails again.
   3. **`data_source.vix.allow_cboe_vix3m_fallback` deleted from the Mac's
      `config/data.yaml`.** It does not block startup (see Corrected claims),
      but it does leave `startup: GONE data (paper_data_composition_refused)`
      with entries IMPOSSIBLE — so a healthy `/readiness` is unreachable while
      it is present. Also set `execution.mode: "off"` **quoted**.

   Only with all three does `/readiness` show real build identity and honest
   mode, both session domains healthy with real cookie age and verification
   time, `open_interest` as `cboe_intraday_authority_removed`, and `vix3m`
   measured `DELAYED(900 s)` with its structural label.
2. **Decision D3** — the first PAPER order: structure, scenario, time window.
   Gates S4.
3. **Issue [thomaswillner/spx-0dte-bot-v2#274](https://github.com/thomaswillner/spx-0dte-bot-v2/issues/274)'s open question** — `docs/design/168/round-4/renders/`, 216 PNGs,
   31,278,412 bytes, referenced only by their own `index.json`. [thomaswillner/spx-0dte-bot-v2#283](https://github.com/thomaswillner/spx-0dte-bot-v2/pull/283)
   recommended removing them and keeping the textual record, but left the call
   to the operator, which is why #274 is still open.

Open decisions D1–D8 are listed in the input document §10.

## Corrected claims — measured, after being asserted wrongly

- **A leftover `data_source.vix.allow_cboe_vix3m_fallback` does NOT refuse
  startup.** This file said it did. Measured on the Mac ([thomaswillner/spx-0dte-bot-v2#291](https://github.com/thomaswillner/spx-0dte-bot-v2/pull/291)): `extra="forbid"`
  fires inside *provider composition* and is converted to
  `startup: GONE data (paper_data_composition_refused)` with "entries are
  IMPOSSIBLE" — with a live Gateway the process **runs and binds** in that
  state. Startup refusals for raw YAML come from `settings_adapter.py`'s named
  `STRATEGY_OWNED_PATHS`, which this key is not on.
  *Provenance of the error:* [thomaswillner/spx-0dte-bot-v2#270](https://github.com/thomaswillner/spx-0dte-bot-v2/pull/270)'s body and the `production_data.py:89`
  comment both assert the refusal; it was copied from them into this file, the
  Mac dispatch prompt and several summaries **without ever being run**. The
  code comment is still wrong and is worth a fix lane.
  *The rule this broke is already in `LESSONS.md` §13* — never publish a claim
  you have not run in the form you state it.
  **Do not over-correct the other way:** deleting the key is still REQUIRED
  before a runtime-proof attempt. Only the reason was wrong. It does not stop
  the process binding; it does leave data composition GONE and entries
  IMPOSSIBLE, so `/readiness` cannot come up healthy while it is there.
- **`execution.mode` must be quoted.** Bare `off` is YAML `False` and the loader
  refuses it by design. Set `execution.mode: "off"`.

## Standing facts that keep getting re-derived

- **MATS, superpowers and Prime's route selection are Mac-harness resident.**
  Not in any repo, not in a cloud session. `~/.prime` does not exist there.
  A remote agent states this and uses repo conventions — the portable floor is a
  committed `docs/superpowers/plans/<date>-<slug>.md` per slice. Confirmed by
  events: #271 was delivered by the Mac maker fleet via `auto-dispatch`.
- **`auto-dispatch` + `ready-for-agent` is what routes a brief to the fleet.**
  A cloud session taking one of those opens a second lane.
- **A GitHub issue is the weakest authority** (`AGENTS.md` §6), below
  `DECISIONS_LOG.md`, `KNOWN_BUGS.md`, and code+tests.
