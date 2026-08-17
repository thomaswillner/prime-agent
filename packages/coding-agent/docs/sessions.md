# Sessions

Prime Agent saves conversations as sessions so you can continue work, branch from earlier turns, and revisit previous paths.

## Session Storage

Sessions auto-save to `~/.prime/agent/sessions/`. Each session is a JSONL file with a tree structure.

```bash
prime-agent --continue          # Continue the most recent session
prime-agent --resume [path|id]  # Browse past sessions or resume one directly
prime-agent --no-session        # Ephemeral mode; do not save
prime-agent --fork <path|id>    # Fork a session file or partial session ID into a new session
```

Use `/session` in interactive mode to see the current session file, session ID, and message count. Use `/usage` for token, cost, and context usage.

For the JSONL file format and SessionManager API, see [Session Format](session-format.md).

## Session Commands

| Command | Description |
|---------|-------------|
| `/resume` | Browse and select previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set the current session display name |
| `/session` | Show session info |
| `/usage` | Show token, cost, and context usage |
| `/tree` | Navigate the current session tree |
| `/fork` | Create a new session from a previous user message |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact [prompt]` | Summarize older context; see [Compaction](compaction.md) |
| `/export [file]` | Export session to HTML |
| `/share` | Upload as private GitHub gist with shareable HTML link |

## Resuming and Deleting Sessions

`/resume` opens an interactive session picker for the current project. `prime-agent --resume` opens the same picker at startup, and `prime-agent --resume <path|id>` resumes a specific session.

An invalid ID exits with the closest unambiguous session ID when one is available. To open the picker and send an initial prompt after selecting a session, separate the prompt with `--`: `prime-agent --resume -- "continue this work"`.

In the picker you can:

- search by typing
- toggle path display with Ctrl+P
- toggle sort mode with Ctrl+S
- filter to named sessions with Ctrl+N
- rename with Ctrl+R
- delete with Ctrl+D, then confirm

When available, Prime Agent uses the `trash` CLI for deletion instead of permanently removing files.

## Naming Sessions

Use `/name <name>` to set a human-readable session name:

```text
/name Refactor auth module
```

Named sessions are easier to find in `/resume` and `prime-agent --resume`.

## Branching with `/tree`

Sessions are stored as trees. Every entry has an `id` and `parentId`, and the current position is the active leaf. `/tree` lets you jump to any previous point and continue from there without creating a new file.

<p align="center"><img src="images/tree-view.png" alt="Tree View" width="600"></p>

Example shape:

```text
├─ user: "Hello, can you help..."
│  └─ assistant: "Of course! I can..."
│     ├─ user: "Let's try approach A..."
│     │  └─ assistant: "For approach A..."
│     │     └─ user: "That worked..."  ← active
│     └─ user: "Actually, approach B..."
│        └─ assistant: "For approach B..."
```

### Tree Controls

| Key | Action |
|-----|--------|
| ↑/↓ | Navigate visible entries |
| ←/→ | Page up/down |
| Ctrl+←/Ctrl+→ or Alt+←/Alt+→ | Fold/unfold or jump between branch segments |
| Shift+L | Set or clear a label on the selected entry |
| Shift+T | Toggle label timestamps |
| Enter | Select entry |
| Escape/Ctrl+C | Cancel |
| Ctrl+O | Cycle filter mode |

Filter modes are: default, no-tools, user-only, labeled-only, and all. Configure the default with `treeFilterMode` in [Settings](settings.md).

### Selection Behavior

Selecting a user or custom message:

1. Moves the leaf to the selected message's parent.
2. Places the selected message text in the editor.
3. Lets you edit and resubmit, creating a new branch.

Selecting an assistant, tool, compaction, or other non-user entry:

1. Moves the leaf to that entry.
2. Leaves the editor empty.
3. Lets you continue from that point.

Selecting the root user message resets the leaf to an empty conversation and places the original prompt in the editor.

## `/tree`, `/fork`, and `/clone`

| Feature | `/tree` | `/fork` | `/clone` |
|---------|---------|---------|----------|
| Output | Same session file | New session file | New session file |
| View | Full tree | User-message selector | Current active branch |
| Typical use | Explore alternatives in place | Start a new session from an earlier prompt | Duplicate current work before continuing |
| Summary | Optional branch summary | None | None |

Use `/tree` when you want to keep alternatives together. Use `/fork` or `/clone` when you want a separate session file.

## Branch Summaries

When `/tree` switches away from one branch to another, Prime Agent can summarize the abandoned branch and attach that summary at the new position. This preserves important context from the path you left without replaying the whole branch.

When prompted, choose one of:

1. no summary
2. summarize with the default prompt
3. summarize with custom focus instructions

See [Compaction](compaction.md) for branch summarization internals and extension hooks.

## Session Patterns

`prime-agent session patterns` reports deterministic, rule-based patterns across the sessions on disk:

```
Analyzed 143 sessions in ~/.prime/agent/sessions

Rule-based
Split or summarize work before context pressure and mid-task compactions accumulate.
60 of 143 sessions have this deterministic pattern.
Rule: Two or more compactions, or a compaction the agent kept working through in the same turn.
Examples:
  0199a1b2-8c31-7f10-9a44-c0ffee123456  2 compactions (2 mid-task)  /work/prime-agent
  Open one with: prime-agent --resume 0199a1b2-8c31-7f10-9a44-c0ffee123456
```

Each rule is a pure function of a single session file, so the same session store always produces the same counts. Rules with no matches are still printed, which is what makes the report usable for checking a count reported elsewhere against the sessions on disk. Every pattern prints the rule it applied and links example sessions to open.

| Option | Description |
|--------|-------------|
| `--examples <n>` | Example sessions linked per pattern (default: 3, `0` to omit) |
| `--session-dir <dir>` | Analyze a specific session directory instead of the default |
| `--json` | Print the full report, including every example, as JSON |

Current rules:

| Rule | Matches when |
|------|--------------|
| `context-pressure` | The session has two or more compactions, or a compaction the agent kept working through in the same turn |
| `prompt-edits-unverified` | The session edited a prompt surface (`AGENTS.md`, `CLAUDE.md`, skills, prompt templates) and ran nothing afterwards |

Both rules read tool calls, so file changes made through `ipython` or `bash` rather than the `edit` tool are not counted as prompt surface edits.

## Session Format

Session files are JSONL and contain message entries, model changes, thinking-level changes, labels, compactions, branch summaries, and extension entries.

For parsers, extensions, SDK usage, and the full SessionManager API, see [Session Format](session-format.md).
