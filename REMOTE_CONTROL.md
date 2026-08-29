# Remote Control: drive this Mac's Claude Code from iOS

Claude Code **Remote Control** runs the session on this Mac — real local
filesystem, local MCP servers — while the Claude iOS app (or claude.ai) is just
the remote. This is the opposite of Claude Code on the web, which always runs
in an isolated Anthropic cloud container.

Docs: <https://code.claude.com/docs/en/remote-control>

## One-time install (on the Mac)

```bash
cd /path/to/prime-agent
bash scripts/setup-remote-control.sh
```

This installs a LaunchAgent (`ai.openclaw.claude-remote`) that keeps
`claude remote-control` running in this project directory, restarts it if it
dies, and starts it at login. Pass a different project directory as the first
argument to bind it elsewhere.

Then on the iPhone: **Claude app → Code tab** — the Mac session appears with a
green dot and computer icon. Tap it and drive.

## Prerequisites

- Claude Code CLI installed and logged in with a **claude.ai account**
  (`claude` → login flow, or `claude auth login`). API-key auth does not work
  for Remote Control. Pro/Max have it enabled by default; Team/Enterprise need
  an Owner to enable it in admin settings.
- Run `claude` once interactively in the project directory to accept the
  workspace trust dialog (launchd can't answer dialogs).
- `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`,
  and `DISABLE_GROWTHBOOK` must not be set — they disable the feature-flag
  check Remote Control depends on. (launchd doesn't read shell profiles, so a
  profile-only export won't leak into the agent, but the installer warns if it
  sees one.)
- Network: outbound HTTPS to Anthropic only. No inbound ports, no tunnel.

## Operating it

```bash
launchctl list | grep claude-remote            # running?
tail -f ~/Library/Logs/claude-remote-control.log   # session URL + QR live here
bash scripts/setup-remote-control.sh --uninstall   # stop and remove
```

Ad-hoc alternatives without the LaunchAgent: `claude remote-control` (foreground
server), `claude --remote-control "Name"` (interactive local + remote), or
`/remote-control` inside an existing session.
