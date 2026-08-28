#!/usr/bin/env python3
"""Prime Agent protocol recorder.

Records machine-validated evidence that the mandatory development protocol
(RAG -> ToT -> CoT -> implement -> self-refine) was actually executed.
The hook gate in prime_enforcer.py refuses file modifications and mutating
shell commands until the evidence recorded here passes validation, and
refuses to end a turn with unrefined edits.

Usage (run from the repo root):
  python3 .claude/hooks/prime_protocol.py rag --task "..." \
      --source path[:lines] --source ... --summary "..."
  python3 .claude/hooks/prime_protocol.py tot \
      --approach "Name :: description" (x3+) --chosen "Name" --rationale "..."
  python3 .claude/hooks/prime_protocol.py cot --step "..." (x5+) --risk "..."
  python3 .claude/hooks/prime_protocol.py refine --checks "..." --verdict pass|revise
  python3 .claude/hooks/prime_protocol.py express --reason "..."   (audited fast path)
  python3 .claude/hooks/prime_protocol.py status
  python3 .claude/hooks/prime_protocol.py reset --reason "..."

See .claude/ENFORCEMENT.md for the full contract.
"""

import argparse
import json
import os
import sys
import time

RAG_MIN_SOURCES = 3
RAG_MIN_SUMMARY = 200
RAG_MIN_TASK = 20
TOT_MIN_APPROACHES = 3
TOT_MIN_DESC = 60
TOT_MIN_RATIONALE = 120
COT_MIN_STEPS = 5
COT_MIN_STEP_LEN = 20
COT_MIN_RISKS = 1
REFINE_MIN_CHECKS = 80
EXPRESS_MIN_REASON = 40
DEFAULT_TTL_HOURS = 8.0


def repo_root():
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return os.path.realpath(env)
    return os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def state_dir():
    return os.path.join(repo_root(), ".claude", "prime-state")


def state_path():
    return os.path.join(state_dir(), "current.json")


def log_path():
    return os.path.join(state_dir(), "compliance.log")


def empty_state():
    return {
        "version": 1,
        "task": "",
        "started_at": 0,
        "updated_at": 0,
        "phases": {},
        "edits": {"count": 0, "last_at": 0},
        "stop_blocks": 0,
        "express": False,
    }


def load_state():
    try:
        with open(state_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or data.get("version") != 1:
            return empty_state()
        base = empty_state()
        base.update(data)
        return base
    except (OSError, ValueError):
        return empty_state()


def save_state(state, touch=True):
    os.makedirs(state_dir(), exist_ok=True)
    if touch:
        state["updated_at"] = time.time()
    tmp = state_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, state_path())


def log_event(event, detail=""):
    os.makedirs(state_dir(), exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    line = "%s | %s | %s\n" % (stamp, event, detail.replace("\n", " ")[:500])
    with open(log_path(), "a", encoding="utf-8") as f:
        f.write(line)


def ttl_seconds():
    try:
        return float(os.environ.get("PRIME_TTL_HOURS", DEFAULT_TTL_HOURS)) * 3600
    except ValueError:
        return DEFAULT_TTL_HOURS * 3600


def protocol_status(state, now=None):
    """Return (complete, missing_phases, expired)."""
    now = now if now is not None else time.time()
    phases = state.get("phases", {})
    missing = [p for p in ("rag", "tot", "cot") if p not in phases]
    expired = False
    if not missing:
        expired = (now - state.get("updated_at", 0)) > ttl_seconds()
    return (not missing and not expired, missing, expired)


def refine_ok(state):
    """True when the latest refine pass covers the latest edit."""
    refine = state.get("phases", {}).get("refine")
    if not refine or refine.get("verdict") != "pass":
        return False
    return refine.get("at", 0) >= state.get("edits", {}).get("last_at", 0)


def strict_mode():
    return os.environ.get("PRIME_STRICT", "") == "1"


def fail(msg):
    sys.stderr.write("PRIME PROTOCOL REJECTED: %s\n" % msg)
    sys.exit(1)


def cmd_rag(args):
    task = (args.task or "").strip()
    if len(task) < RAG_MIN_TASK:
        fail("--task must describe the work in >=%d chars." % RAG_MIN_TASK)
    sources = [s.strip() for s in (args.source or []) if s.strip()]
    if len(sources) < RAG_MIN_SOURCES:
        fail("--source must be given >=%d times (file[:lines] or a doc/url reference)." % RAG_MIN_SOURCES)
    root = repo_root()
    for src in sources:
        if src.startswith(("http://", "https://", "doc:", "url:")):
            continue
        path = src.split(":", 1)[0]
        candidate = path if os.path.isabs(path) else os.path.join(root, path)
        if not os.path.exists(candidate):
            fail("source '%s' does not exist in the repo; cite files you actually read." % src)
    summary = (args.summary or "").strip()
    if len(summary) < RAG_MIN_SUMMARY:
        fail("--summary must synthesize retrieval in >=%d chars (got %d)." % (RAG_MIN_SUMMARY, len(summary)))
    state = load_state()
    now = time.time()
    state["task"] = task
    state["started_at"] = now
    state["express"] = False
    state["phases"].pop("tot", None)
    state["phases"].pop("cot", None)
    state["phases"]["rag"] = {"at": now, "sources": sources, "summary": summary}
    save_state(state)
    log_event("RAG", "task=%s sources=%s" % (task, ",".join(sources)))
    print("RAG recorded (%d sources). Next: tot" % len(sources))


def parse_approach(raw):
    if "::" not in raw:
        return None
    name, desc = raw.split("::", 1)
    return name.strip(), desc.strip()


def cmd_tot(args):
    state = load_state()
    if "rag" not in state["phases"]:
        fail("record rag first (retrieval grounds the candidate approaches).")
    approaches = []
    for raw in args.approach or []:
        parsed = parse_approach(raw)
        if not parsed:
            fail("--approach must be 'Name :: description' (got '%s')." % raw[:80])
        name, desc = parsed
        if not name or len(desc) < TOT_MIN_DESC:
            fail("approach '%s' needs a name and a >=%d char description." % (name or raw[:40], TOT_MIN_DESC))
        approaches.append({"name": name, "description": desc})
    if len(approaches) < TOT_MIN_APPROACHES:
        fail("explore >=%d distinct approaches (got %d)." % (TOT_MIN_APPROACHES, len(approaches)))
    names = [a["name"] for a in approaches]
    if len(set(names)) != len(names):
        fail("approach names must be distinct.")
    chosen = (args.chosen or "").strip()
    if chosen not in names:
        fail("--chosen must name one recorded approach (options: %s)." % ", ".join(names))
    rationale = (args.rationale or "").strip()
    if len(rationale) < TOT_MIN_RATIONALE:
        fail("--rationale must justify the choice and rejections in >=%d chars." % TOT_MIN_RATIONALE)
    state["phases"].pop("cot", None)
    state["phases"]["tot"] = {
        "at": time.time(),
        "approaches": approaches,
        "chosen": chosen,
        "rationale": rationale,
    }
    save_state(state)
    log_event("TOT", "chosen=%s of %s" % (chosen, ",".join(names)))
    print("ToT recorded (%d approaches, chose '%s'). Next: cot" % (len(approaches), chosen))


def cmd_cot(args):
    state = load_state()
    if "tot" not in state["phases"]:
        fail("record tot first (the plan implements the chosen approach).")
    steps = [s.strip() for s in (args.step or []) if s.strip()]
    if len(steps) < COT_MIN_STEPS:
        fail("give >=%d explicit --step entries (got %d)." % (COT_MIN_STEPS, len(steps)))
    for s in steps:
        if len(s) < COT_MIN_STEP_LEN:
            fail("step '%s' is too thin; each step needs >=%d chars." % (s[:40], COT_MIN_STEP_LEN))
    risks = [r.strip() for r in (args.risk or []) if r.strip()]
    if len(risks) < COT_MIN_RISKS:
        fail("name >=%d --risk (what could make this change wrong, and the check for it)." % COT_MIN_RISKS)
    state["phases"]["cot"] = {"at": time.time(), "steps": steps, "risks": risks}
    save_state(state)
    log_event("COT", "%d steps, %d risks" % (len(steps), len(risks)))
    print("CoT recorded (%d steps). Protocol open: implement, then refine before stopping." % len(steps))


def cmd_refine(args):
    state = load_state()
    complete, missing, expired = protocol_status(state)
    if missing:
        fail("protocol incomplete (missing: %s); refine reviews work done under it." % ", ".join(missing))
    if state["edits"]["count"] < 1:
        fail("no gated edits recorded yet; refine reviews actual changes.")
    checks = (args.checks or "").strip()
    if len(checks) < REFINE_MIN_CHECKS:
        fail("--checks must report what was verified (commands run, results) in >=%d chars." % REFINE_MIN_CHECKS)
    verdict = args.verdict
    state["phases"]["refine"] = {"at": time.time(), "checks": checks, "verdict": verdict}
    state["stop_blocks"] = 0
    save_state(state)
    log_event("REFINE", "verdict=%s checks=%s" % (verdict, checks[:200]))
    if verdict == "pass":
        print("Refine recorded: pass. The stop gate is satisfied for the current edits.")
    else:
        print("Refine recorded: revise. Apply the revisions, then refine again to pass.")


def cmd_express(args):
    if strict_mode():
        fail("PRIME_STRICT=1: the express lane is disabled; run the full protocol.")
    reason = (args.reason or "").strip()
    if len(reason) < EXPRESS_MIN_REASON:
        fail("--reason must justify skipping the full protocol in >=%d chars." % EXPRESS_MIN_REASON)
    state = load_state()
    now = time.time()
    state["task"] = "EXPRESS: " + reason
    state["started_at"] = now
    state["express"] = True
    note = "express lane: " + reason
    state["phases"]["rag"] = {"at": now, "sources": ["express"], "summary": note}
    state["phases"]["tot"] = {"at": now, "approaches": [], "chosen": "express", "rationale": note}
    state["phases"]["cot"] = {"at": now, "steps": [note], "risks": [note]}
    save_state(state)
    log_event("EXPRESS", reason)
    print("Express lane recorded (audited in compliance.log). Refine is still required before stopping.")


def cmd_status(_args):
    state = load_state()
    complete, missing, expired = protocol_status(state)
    phases = state.get("phases", {})
    print("Prime protocol state (%s)" % state_path())
    print("  task: %s" % (state.get("task") or "(none)"))
    for name in ("rag", "tot", "cot", "refine"):
        mark = "[x]" if name in phases else "[ ]"
        extra = ""
        if name == "refine" and name in phases:
            extra = " verdict=%s" % phases[name].get("verdict")
        print("  %s %s%s" % (mark, name, extra))
    print("  edits gated: %d (last %s)" % (
        state["edits"]["count"],
        time.strftime("%H:%M:%S", time.localtime(state["edits"]["last_at"])) if state["edits"]["last_at"] else "never",
    ))
    if expired:
        print("  status: EXPIRED (idle > %.1fh); re-run rag to open a new cycle" % (ttl_seconds() / 3600))
    elif complete:
        print("  status: OPEN (edits allowed); refine %s" % ("satisfied" if refine_ok(state) else "pending"))
    else:
        print("  status: LOCKED (missing: %s)" % ", ".join(missing))


def cmd_reset(args):
    reason = (args.reason or "").strip()
    if len(reason) < 10:
        fail("--reason (>=10 chars) is required; resets are audited.")
    save_state(empty_state())
    log_event("RESET", reason)
    print("Protocol state reset. Run rag to open a new cycle.")


def main():
    parser = argparse.ArgumentParser(prog="prime_protocol.py", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("rag", help="record retrieval grounding")
    p.add_argument("--task", required=True)
    p.add_argument("--source", action="append", required=True)
    p.add_argument("--summary", required=True)
    p.set_defaults(func=cmd_rag)

    p = sub.add_parser("tot", help="record tree-of-thoughts exploration")
    p.add_argument("--approach", action="append", required=True)
    p.add_argument("--chosen", required=True)
    p.add_argument("--rationale", required=True)
    p.set_defaults(func=cmd_tot)

    p = sub.add_parser("cot", help="record the chain-of-thought plan")
    p.add_argument("--step", action="append", required=True)
    p.add_argument("--risk", action="append", required=True)
    p.set_defaults(func=cmd_cot)

    p = sub.add_parser("refine", help="record the self-refinement pass")
    p.add_argument("--checks", required=True)
    p.add_argument("--verdict", required=True, choices=["pass", "revise"])
    p.set_defaults(func=cmd_refine)

    p = sub.add_parser("express", help="audited fast path for trivial changes")
    p.add_argument("--reason", required=True)
    p.set_defaults(func=cmd_express)

    p = sub.add_parser("status", help="show protocol state")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("reset", help="clear protocol state (audited)")
    p.add_argument("--reason", required=True)
    p.set_defaults(func=cmd_reset)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
