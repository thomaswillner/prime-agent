#!/usr/bin/env python3
"""Prime Agent delegation gate.

One rule, enforced deterministically by Claude Code hooks: all development
work in this repo is done by the Prime Agent runtime - this repository's
own agent framework (prime-agent, Prime Intellect's self-improving RLM
coding agent) - never by Claude Code's main thread. File edits and mutating
shell commands are denied unless a prime-agent run is active or recently
finished. Nothing else is policed.

Hook mode (no argv; hook JSON on stdin, routed on hook_event_name):
  PreToolUse                      -> deny edits and mutating Bash while closed
  SessionStart / UserPromptSubmit -> inject the mandate and gate state

CLI mode:
  python3 .claude/hooks/prime_enforcer.py run --task "..." [-- extra args]
      Drive the prime-agent runtime headlessly (prime-agent -p <task>).
      The gate is open during the run; a successful exit starts the grace
      window so the result can be committed and pushed.
  python3 .claude/hooks/prime_enforcer.py status|open|close
      Inspect the gate; open/close are the logged manual fallback.

Runtime resolution for run: $PRIME_AGENT_BIN, else prime-agent on PATH,
else ./prime-agent.sh at the repo root.

Env: PRIME_ENFORCE=0 disables the gate. PRIME_GRACE_MINUTES (default 30)
keeps the gate open after a successful run so the main thread can commit
and push its work. PRIME_ACTIVE_CAP_HOURS (default 4) bounds a run that
never reports finishing. Every run, open, close, and denial is logged to
.claude/prime-state/compliance.log.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import time

DEFAULT_GRACE_MINUTES = 30.0
DEFAULT_ACTIVE_CAP_HOURS = 4.0
EDIT_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
SAFE_WRITE_PREFIXES = ("/dev/", "/tmp/", "/proc/")

GIT_WRITE_RE = re.compile(r"\bgit\s+(?:[a-z-]+\s+)*?(commit|push|merge|rebase|cherry-pick|revert|am|apply)\b")
INPLACE_EDIT_RE = re.compile(r"\b(?:sed|perl)\b[^|;&]*\s-[a-zA-Z]*i")
TEE_RE = re.compile(r"\btee\s+(?:-[a-zA-Z]+\s+)*([^\s;|&]+)")
PKG_MUTATE_RE = re.compile(r"\b(?:npm|pnpm|yarn|bun)\s+(?:-[^\s]+\s+)*(install|ci|add|update|up|uninstall|remove|publish|version|link)\b")
FIXER_RE = re.compile(r"\b(?:biome|eslint|prettier|ruff)\b[^|;&]*--(?:write|fix)\b")
FILE_MUTATE_RE = re.compile(r"(?:^|[;&|]\s*|\$\()\s*(?:sudo\s+)?(mv|cp|rm|touch|mkdir|ln|truncate|dd|patch|rmdir|unzip|tar)\b([^;&|]*)")
REDIRECT_RE = re.compile(r"(?<![<>=\-\d&])>{1,2}(?!&)\s*([^\s;|&)]*)")


def repo_root():
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return os.path.realpath(env)
    return os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def state_dir():
    return os.path.join(repo_root(), ".claude", "prime-state")


def gate_path():
    return os.path.join(state_dir(), "gate.json")


def log_path():
    return os.path.join(state_dir(), "compliance.log")


def enforcement_on():
    return os.environ.get("PRIME_ENFORCE", "1") != "0"


def grace_seconds():
    try:
        return float(os.environ.get("PRIME_GRACE_MINUTES", DEFAULT_GRACE_MINUTES)) * 60
    except ValueError:
        return DEFAULT_GRACE_MINUTES * 60


def active_cap_seconds():
    try:
        return float(os.environ.get("PRIME_ACTIVE_CAP_HOURS", DEFAULT_ACTIVE_CAP_HOURS)) * 3600
    except ValueError:
        return DEFAULT_ACTIVE_CAP_HOURS * 3600


def load_gate():
    try:
        with open(gate_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {"active_until": float(data.get("active_until", 0)),
                    "last_run_at": float(data.get("last_run_at", 0)),
                    "opened_by": str(data.get("opened_by", ""))}
    except (OSError, ValueError):
        pass
    return {"active_until": 0.0, "last_run_at": 0.0, "opened_by": ""}


def save_gate(gate):
    os.makedirs(state_dir(), exist_ok=True)
    tmp = gate_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(gate, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, gate_path())


def log_event(event, detail=""):
    os.makedirs(state_dir(), exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    with open(log_path(), "a", encoding="utf-8") as f:
        f.write("%s | %s | %s\n" % (stamp, event, detail.replace("\n", " ")[:500]))


def gate_open(now=None):
    """Return (open, why)."""
    now = now if now is not None else time.time()
    gate = load_gate()
    if now < gate["active_until"]:
        return True, "prime-agent run active (%s)" % (gate["opened_by"] or "unknown")
    grace = grace_seconds()
    if gate["last_run_at"] and (now - gate["last_run_at"]) < grace:
        left = int((grace - (now - gate["last_run_at"])) / 60)
        return True, "grace window after a prime-agent run (~%dm left)" % max(left, 1)
    return False, "no active or recent prime-agent run"


def open_gate(source):
    now = time.time()
    gate = load_gate()
    gate["active_until"] = now + active_cap_seconds()
    gate["opened_by"] = source
    save_gate(gate)
    log_event("GATE_OPEN", source)


def close_gate(source):
    now = time.time()
    gate = load_gate()
    gate["active_until"] = 0.0
    gate["last_run_at"] = now
    save_gate(gate)
    log_event("GATE_CLOSE", source)


def respond(payload):
    print(json.dumps(payload))


def under_root(path):
    root = repo_root() + os.sep
    real = os.path.realpath(path if os.path.isabs(path) else os.path.join(repo_root(), path))
    return real.startswith(root), real


def in_state_dir(path):
    ok, real = under_root(path)
    return ok and real.startswith(os.path.realpath(state_dir()))


def deny_reason(why):
    return "\n".join([
        "PRIME AGENT GATE: blocked (%s)." % why,
        "All development work in this repository is done by the Prime Agent runtime",
        "(this repo's agent framework), never by Claude Code directly. Dispatch the",
        "complete task to it now:",
        "  python3 .claude/hooks/prime_enforcer.py run --task \"<the full task>\"",
        "That drives prime-agent -p headlessly; a successful run keeps this gate open",
        "for a grace window so you can commit and push what the runtime produced.",
        "Research, questions, and read-only commands are never blocked.",
        "Inspect: python3 .claude/hooks/prime_enforcer.py status  (docs: .claude/ENFORCEMENT.md)",
    ])


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
    is_open, why = gate_open()

    if tool in EDIT_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path")
        if not path:
            return
        if in_state_dir(path):
            log_event("TAMPER", "%s -> %s" % (tool, path))
            deny("Gate state is managed only via prime_enforcer.py; direct writes are refused and logged.")
            return
        inside, _real = under_root(path)
        if not inside or is_open:
            return
        log_event("DENY_EDIT", "%s %s" % (tool, path))
        deny(deny_reason(why))
        return

    if tool == "Bash":
        cmd = tool_input.get("command") or ""
        if "prime-state" in cmd and "prime_enforcer.py" not in cmd:
            log_event("TAMPER", "bash: %s" % cmd[:200])
            deny("Direct access to .claude/prime-state is refused and logged; use python3 .claude/hooks/prime_enforcer.py status instead.")
            return
        if "prime_enforcer.py" in cmd or is_open:
            return
        mutation = bash_mutates(cmd)
        if mutation:
            log_event("DENY_BASH", "%s :: %s" % (mutation, cmd[:200]))
            deny(deny_reason("%s; %s" % (mutation, why)))
        return


def resolve_runtime():
    env_bin = os.environ.get("PRIME_AGENT_BIN")
    if env_bin:
        return env_bin if os.path.exists(env_bin) else None
    on_path = shutil.which("prime-agent")
    if on_path:
        return on_path
    local = os.path.join(repo_root(), "prime-agent.sh")
    return local if os.path.exists(local) else None


def cli_run(args):
    task = None
    extra = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--task":
            i += 1
            if i >= len(args):
                sys.stderr.write("run: --task requires a value\n")
                return 2
            task = args[i]
        elif arg == "--":
            extra = args[i + 1:]
            break
        else:
            extra.append(arg)
        i += 1
    if not task:
        sys.stderr.write("usage: prime_enforcer.py run --task \"<task>\" [-- extra prime-agent args]\n")
        return 2
    binary = resolve_runtime()
    if not binary:
        log_event("RUN_UNAVAILABLE", task[:200])
        sys.stderr.write(
            "prime-agent runtime not found: set PRIME_AGENT_BIN, install prime-agent on\n"
            "PATH, or run from a checkout containing prime-agent.sh. The gate stays closed.\n")
        return 3
    open_gate("runtime-run")
    log_event("RUN_START", "%s :: %s" % (binary, task[:300]))
    try:
        code = subprocess.run([binary, "-p", task] + extra, cwd=repo_root()).returncode
    except OSError as exc:
        code = 4
        sys.stderr.write("failed to execute %s: %r\n" % (binary, exc))
    if code == 0:
        close_gate("runtime-run")
        log_event("RUN_OK", task[:200])
        print("prime-agent run finished. Grace window open for commit/push.")
    else:
        gate = load_gate()
        gate["active_until"] = 0.0
        save_gate(gate)
        log_event("RUN_FAILED", "exit=%d :: %s" % (code, task[:200]))
        sys.stderr.write("prime-agent exited %d; no grace credit granted.\n" % code)
    return code


SHARED_MEMORY_BUDGET = 6000


def shared_memory_snippets():
    """Latest SESSION_LEARNINGS per orchestration workstream, budget-capped."""
    base = os.path.join(repo_root(), "orchestration")
    parts = []
    budget = SHARED_MEMORY_BUDGET
    if not os.path.isdir(base):
        return parts
    for ws in sorted(os.listdir(base)):
        d = os.path.join(base, ws)
        if not os.path.isdir(d):
            continue
        names = sorted(n for n in os.listdir(d) if n.startswith("SESSION_LEARNINGS"))
        if not names:
            continue
        try:
            with open(os.path.join(d, names[-1]), "r", encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        snippet = text[:budget]
        parts.append("--- shared memory orchestration/%s/%s ---\n%s" % (ws, names[-1], snippet))
        budget -= len(snippet)
        if budget <= 0:
            break
    return parts


def state_line():
    is_open, why = gate_open()
    return "gate %s: %s" % ("OPEN" if is_open else "CLOSED", why)


def handle_user_prompt_submit(_data):
    context = (
        "[PRIME MANDATE] All development work in this repo is done by the Prime Agent\n"
        "runtime (this repository's agent framework). Dispatch tasks via\n"
        "python3 .claude/hooks/prime_enforcer.py run --task \"<task>\" - hooks deny\n"
        "direct edits and mutating commands otherwise. Research is unrestricted.\n"
        "State: " + state_line()
    )
    respond({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    })


def handle_session_start(data):
    log_event("SESSION_START", data.get("session_id", ""))
    context = (
        "[PRIME BRIEFING] All development work in this repository is done by the\n"
        "Prime Agent runtime - the agent framework this repo ships (prime-agent).\n"
        "Claude Code never implements directly: hooks deny file edits and mutating\n"
        "shell commands in the main thread (see CLAUDE.md, .claude/ENFORCEMENT.md).\n"
        "Dispatch tasks with python3 .claude/hooks/prime_enforcer.py run --task\n"
        "\"<task>\"; after a successful run a grace window lets the main thread\n"
        "commit and push the result. State: " + state_line()
    )
    memory = shared_memory_snippets()
    if memory:
        context += (
            "\n\nRead-first shared memory (orchestration layer) - do not repeat "
            "recorded mistakes:\n\n" + "\n\n".join(memory)
        )
    respond({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    })


HANDLERS = {
    "PreToolUse": handle_pre_tool_use,
    "UserPromptSubmit": handle_user_prompt_submit,
    "SessionStart": handle_session_start,
}


def cli(argv):
    cmd = argv[0]
    if cmd == "run":
        return cli_run(argv[1:])
    if cmd == "status":
        gate = load_gate()
        print(state_line())
        if gate["last_run_at"]:
            print("last prime-agent run finished: %s" % time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(gate["last_run_at"])))
        print("enforcement: %s (PRIME_ENFORCE), grace: %.0fm, active cap: %.1fh" % (
            "on" if enforcement_on() else "OFF", grace_seconds() / 60, active_cap_seconds() / 3600))
        return 0
    if cmd == "open":
        open_gate("manual")
        log_event("MANUAL_OPEN", "opened via CLI")
        print("Gate opened (logged manual fallback).")
        return 0
    if cmd == "close":
        close_gate("manual")
        print("Gate closed; grace window starts now.")
        return 0
    sys.stderr.write("usage: prime_enforcer.py run --task \"...\" | status|open|close\n")
    return 2


def main():
    if len(sys.argv) > 1:
        sys.exit(cli(sys.argv[1:]))
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    event = data.get("hook_event_name", "")
    handler = HANDLERS.get(event)
    if not handler:
        return
    if event == "PreToolUse" and not enforcement_on():
        return
    try:
        handler(data)
    except Exception as exc:  # fail-open: enforcement must never break the session
        sys.stderr.write("prime_enforcer error (fail-open): %r\n" % exc)


if __name__ == "__main__":
    main()
