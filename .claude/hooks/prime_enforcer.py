#!/usr/bin/env python3
"""Prime Agent protocol enforcer, wired as Claude Code hooks.

One entry point for every hook event (routed on hook_event_name from stdin):
  SessionStart     -> inject the protocol briefing
  UserPromptSubmit -> inject the mandate plus live protocol state
  PreToolUse       -> deny Edit/Write/NotebookEdit and mutating Bash commands
                      until the recorded protocol evidence validates
  PostToolUse      -> count gated edits (drives the refine requirement)
  Stop             -> block ending the turn while edits lack a passing refine

The harness executes these hooks deterministically; the model cannot skip
them. Escape hatches (all audited or explicit): PRIME_ENFORCE=0 disables
gating, the express lane in prime_protocol.py logs a justification, and the
Stop gate yields after PRIME_MAX_STOP_BLOCKS to avoid livelock.
"""

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prime_protocol as proto

EDIT_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
SAFE_WRITE_PREFIXES = ("/dev/", "/tmp/", "/proc/")
DEFAULT_MAX_STOP_BLOCKS = 3

GIT_WRITE_RE = re.compile(r"\bgit\s+(?:[a-z-]+\s+)*?(commit|push|merge|rebase|cherry-pick|revert|am|apply)\b")
INPLACE_EDIT_RE = re.compile(r"\b(?:sed|perl)\b[^|;&]*\s-[a-zA-Z]*i")
TEE_RE = re.compile(r"\btee\s+(?:-[a-zA-Z]+\s+)*([^\s;|&]+)")
PKG_MUTATE_RE = re.compile(r"\b(?:npm|pnpm|yarn|bun)\s+(?:-[^\s]+\s+)*(install|ci|add|update|up|uninstall|remove|publish|version|link)\b")
FIXER_RE = re.compile(r"\b(?:biome|eslint|prettier|ruff)\b[^|;&]*--(?:write|fix)\b")
FILE_MUTATE_RE = re.compile(r"(?:^|[;&|]\s*|\$\()\s*(?:sudo\s+)?(mv|cp|rm|touch|mkdir|ln|truncate|dd|patch|rmdir|unzip|tar)\b([^;&|]*)")
REDIRECT_RE = re.compile(r"(?<![<>=\-\d&])>{1,2}(?!&)\s*([^\s;|&)]*)")


def enforcement_on():
    return os.environ.get("PRIME_ENFORCE", "1") != "0"


def max_stop_blocks():
    try:
        return int(os.environ.get("PRIME_MAX_STOP_BLOCKS", DEFAULT_MAX_STOP_BLOCKS))
    except ValueError:
        return DEFAULT_MAX_STOP_BLOCKS


def respond(payload):
    print(json.dumps(payload))


def under_root(path):
    root = proto.repo_root() + os.sep
    real = os.path.realpath(path if os.path.isabs(path) else os.path.join(proto.repo_root(), path))
    return real.startswith(root), real


def in_state_dir(path):
    ok, real = under_root(path)
    return ok and real.startswith(os.path.realpath(proto.state_dir()))


def gate_summary(state):
    complete, missing, expired = proto.protocol_status(state)
    if complete:
        return True, ""
    if expired:
        why = "the recorded protocol EXPIRED (idle longer than PRIME_TTL_HOURS); open a fresh cycle"
    else:
        why = "missing phases: " + ", ".join(missing)
    return False, why


def deny_reason(why):
    lines = [
        "PRIME AGENT PROTOCOL GATE: blocked (%s)." % why,
        "All coding and development work in this repo MUST run the Prime Agent pipeline",
        "(RAG -> ToT -> CoT -> implement -> self-refine) and record evidence first:",
        "1. RAG: read the relevant code/docs, then record what grounds the change:",
        "   python3 .claude/hooks/prime_protocol.py rag --task \"<work item>\" \\",
        "     --source <file:lines> --source <file:lines> --source <file:lines> \\",
        "     --summary \"<what retrieval established, >=200 chars>\"",
        "2. ToT: explore >=3 candidate approaches, pick one:",
        "   python3 .claude/hooks/prime_protocol.py tot --approach \"A :: <desc>\" \\",
        "     --approach \"B :: <desc>\" --approach \"C :: <desc>\" \\",
        "     --chosen \"A\" --rationale \"<why A, why not B/C, >=120 chars>\"",
        "3. CoT: commit to an explicit step plan:",
        "   python3 .claude/hooks/prime_protocol.py cot --step \"...\" (x5+) --risk \"...\"",
        "Then retry this action. After implementing, run the repo checks and record",
        "  python3 .claude/hooks/prime_protocol.py refine --checks \"...\" --verdict pass",
        "before ending the turn.",
    ]
    if not proto.strict_mode():
        lines.append("Genuinely trivial change? Audited fast path:")
        lines.append("  python3 .claude/hooks/prime_protocol.py express --reason \"<justification, >=40 chars>\"")
    lines.append("Inspect state: python3 .claude/hooks/prime_protocol.py status  (docs: .claude/ENFORCEMENT.md)")
    return "\n".join(lines)


def deny(reason):
    respond({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    })


def strip_quoted(cmd):
    """Drop quotes but keep their content with shell metacharacters neutralized,
    so `grep "->"` never looks like a redirect while `> "/tmp/x"` keeps its target."""
    return re.sub(r"'[^']*'|\"[^\"]*\"", lambda m: re.sub(r"[><|;&]", "_", m.group(0)[1:-1]), cmd)


def safe_target(token):
    if not token:
        return True
    if token.startswith("$") or token.startswith(SAFE_WRITE_PREFIXES):
        return True
    ok, _real = under_root(token)
    return not ok


def bash_mutates(cmd):
    """Return a reason string when cmd looks like it mutates the repo, else None."""
    stripped = strip_quoted(cmd)
    m = GIT_WRITE_RE.search(stripped)
    if m:
        return "git %s writes history" % m.group(1)
    if INPLACE_EDIT_RE.search(stripped):
        return "in-place edit (sed/perl -i)"
    if PKG_MUTATE_RE.search(stripped):
        return "package mutation"
    if FIXER_RE.search(stripped):
        return "auto-fixer writes files"
    for m in TEE_RE.finditer(stripped):
        if not safe_target(m.group(1)):
            return "tee writes into the repo"
    for m in REDIRECT_RE.finditer(stripped):
        if not safe_target(m.group(1)):
            return "output redirection writes into the repo"
    for m in FILE_MUTATE_RE.finditer(stripped):
        tool, rest = m.group(1), m.group(2)
        targets = [t for t in rest.split() if not t.startswith("-")]
        if any(not safe_target(t) for t in targets):
            return "%s targets repo files" % tool
    return None


def handle_pre_tool_use(data):
    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    state = proto.load_state()
    open_, why = gate_summary(state)

    if tool in EDIT_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path")
        if not path:
            return
        if in_state_dir(path):
            proto.log_event("TAMPER", "%s -> %s" % (tool, path))
            deny("Protocol state is written only via prime_protocol.py; direct writes are refused and logged.")
            return
        inside, _real = under_root(path)
        if not inside:
            return
        if open_:
            return
        proto.log_event("DENY_EDIT", "%s %s (%s)" % (tool, path, why))
        deny(deny_reason(why))
        return

    if tool == "Bash":
        cmd = tool_input.get("command") or ""
        if "prime-state" in cmd and "prime_protocol.py" not in cmd:
            proto.log_event("TAMPER", "bash: %s" % cmd[:200])
            deny("Direct access to .claude/prime-state is refused and logged; use python3 .claude/hooks/prime_protocol.py status (or rag/tot/cot/refine) instead.")
            return
        if "prime_protocol.py" in cmd or open_:
            return
        mutation = bash_mutates(cmd)
        if mutation:
            proto.log_event("DENY_BASH", "%s :: %s" % (mutation, cmd[:200]))
            deny(deny_reason("%s; %s" % (mutation, why)))
        return


def handle_post_tool_use(data):
    tool = data.get("tool_name", "")
    if tool not in EDIT_TOOLS:
        return
    tool_input = data.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not path:
        return
    inside, _real = under_root(path)
    if not inside or in_state_dir(path):
        return
    state = proto.load_state()
    state["edits"]["count"] += 1
    state["edits"]["last_at"] = time.time()
    proto.save_state(state)


def state_line(state):
    phases = state.get("phases", {})
    marks = " ".join(
        "%s:%s" % (name, "done" if name in phases else "PENDING")
        for name in ("rag", "tot", "cot", "refine")
    )
    complete, missing, expired = proto.protocol_status(state)
    if expired:
        status = "EXPIRED (re-run rag)"
    elif complete:
        status = "OPEN (edits allowed; refine %s)" % ("satisfied" if proto.refine_ok(state) else "pending")
    else:
        status = "LOCKED (run: " + ", ".join(missing) + ")"
    return "%s | %s | gated edits: %d" % (status, marks, state["edits"]["count"])


def handle_user_prompt_submit(_data):
    if not enforcement_on():
        return
    state = proto.load_state()
    context = (
        "[PRIME AGENT PROTOCOL - ENFORCED BY HOOKS]\n"
        "Any coding or development work (implementing, fixing, refactoring, config or doc\n"
        "edits inside this repo) MUST go through the Prime Agent pipeline: RAG (retrieve\n"
        "and cite real sources) -> ToT (>=3 candidate approaches, pick one) -> CoT\n"
        "(explicit step plan) -> implement -> self-refine (run checks, record verdict).\n"
        "File edits and mutating shell commands are DENIED by PreToolUse hooks until\n"
        "phases are recorded via python3 .claude/hooks/prime_protocol.py, and the Stop\n"
        "hook blocks ending the turn while edits lack a passing refine. Delegate deep\n"
        "work to the prime-agent subagent or run /prime for the guided pipeline.\n"
        "Pure questions/research need no protocol. Current state: " + state_line(state)
    )
    respond({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    })


def handle_session_start(data):
    if not enforcement_on():
        return
    proto.log_event("SESSION_START", data.get("session_id", ""))
    state = proto.load_state()
    context = (
        "[PRIME AGENT PROTOCOL BRIEFING]\n"
        "This repository enforces the Prime Agent development protocol with deterministic\n"
        "hooks (see .claude/ENFORCEMENT.md and CLAUDE.md). For ANY coding or development\n"
        "work you must, in order:\n"
        "1. RAG: read the relevant code/docs, then record >=3 cited sources and a >=200\n"
        "   char synthesis: python3 .claude/hooks/prime_protocol.py rag ...\n"
        "2. ToT: record >=3 distinct approaches, the chosen one, and a rationale:\n"
        "   python3 .claude/hooks/prime_protocol.py tot ...\n"
        "3. CoT: record a >=5 step plan plus risks: python3 .claude/hooks/prime_protocol.py cot ...\n"
        "4. Implement (file edits unlock only after 1-3).\n"
        "5. Self-refine: run the repo's checks (npm run check, relevant tests), review your\n"
        "   own diff adversarially, then record: python3 .claude/hooks/prime_protocol.py refine\n"
        "   --checks \"...\" --verdict pass. The Stop hook blocks the turn ending without it.\n"
        "The /prime skill walks this pipeline; the prime-agent subagent runs it end to end.\n"
        "Trivial changes may use the audited express lane. Current state: " + state_line(state)
    )
    respond({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    })


def handle_stop(data):
    if not enforcement_on():
        return
    state = proto.load_state()
    if state["edits"]["count"] == 0:
        return
    if proto.refine_ok(state):
        if state.get("stop_blocks"):
            state["stop_blocks"] = 0
            proto.save_state(state, touch=False)
        return
    state["stop_blocks"] = state.get("stop_blocks", 0) + 1
    proto.save_state(state, touch=False)
    if state["stop_blocks"] > max_stop_blocks():
        proto.log_event("VIOLATION", "stop allowed after %d blocks without refine" % (state["stop_blocks"] - 1))
        respond({"systemMessage": "Prime protocol violation logged: turn ended with edits but no passing refine (see .claude/prime-state/compliance.log)."})
        return
    proto.log_event("STOP_BLOCK", "edits=%d stop_blocks=%d" % (state["edits"]["count"], state["stop_blocks"]))
    respond({
        "decision": "block",
        "reason": (
            "PRIME AGENT PROTOCOL: you modified files this session but the self-refinement "
            "phase is missing or predates the latest edit. Before stopping: (1) run the "
            "repo's checks for what you touched (npm run check after code changes; the "
            "relevant tests per AGENTS.md), (2) re-read your own diff adversarially, fix "
            "what you find, then (3) record the pass: python3 .claude/hooks/prime_protocol.py "
            "refine --checks \"<commands run and their results>\" --verdict pass "
            "(use --verdict revise if issues remain, fix them, and refine again)."
        ),
    })


HANDLERS = {
    "PreToolUse": handle_pre_tool_use,
    "PostToolUse": handle_post_tool_use,
    "UserPromptSubmit": handle_user_prompt_submit,
    "SessionStart": handle_session_start,
    "Stop": handle_stop,
}


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    handler = HANDLERS.get(data.get("hook_event_name", ""))
    if not handler:
        return
    if data.get("hook_event_name") in ("PreToolUse", "PostToolUse") and not enforcement_on():
        return
    try:
        handler(data)
    except Exception as exc:  # fail-open: enforcement must never break the session
        sys.stderr.write("prime_enforcer error (fail-open): %r\n" % exc)


if __name__ == "__main__":
    main()
