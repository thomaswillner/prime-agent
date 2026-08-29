#!/usr/bin/env bash
#
# Installs Claude Code Remote Control as an always-on macOS LaunchAgent, so
# sessions running on this Mac can be driven from the Claude iOS/web app
# (Claude app -> Code tab). The session executes locally against the real
# filesystem; the phone is only the remote.
#
#   bash scripts/setup-remote-control.sh [project-dir]   install (default: cwd)
#   bash scripts/setup-remote-control.sh --uninstall     stop + remove the agent
#   DRY_RUN=1 bash scripts/setup-remote-control.sh       print the plist, change nothing
#
# Requires: Claude Code CLI logged in via a claude.ai account (Pro/Max/Team),
# not an API key. Docs: https://code.claude.com/docs/en/remote-control

set -euo pipefail

LABEL="ai.openclaw.claude-remote"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_PATH="$HOME/Library/Logs/claude-remote-control.log"
DRY_RUN="${DRY_RUN:-0}"

xml_escape() {
	printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

if [ "$DRY_RUN" != "1" ] && [ "$(uname -s)" != "Darwin" ]; then
	echo "error: this installs a macOS LaunchAgent; run it on the Mac itself." >&2
	exit 1
fi

if [ "${1:-}" = "--uninstall" ]; then
	launchctl unload "$PLIST_PATH" 2>/dev/null || true
	rm -f "$PLIST_PATH"
	echo "Removed $LABEL. Log kept at $LOG_PATH"
	exit 0
fi

# Resolve the claude binary to an absolute path; launchd has no shell profile.
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CLAUDE_BIN" ]; then
	for candidate in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
		if [ -x "$candidate" ]; then CLAUDE_BIN="$candidate" && break; fi
	done
fi
if [ -z "$CLAUDE_BIN" ]; then
	if [ "$DRY_RUN" = "1" ]; then
		CLAUDE_BIN="/usr/local/bin/claude"
	else
		echo "error: claude CLI not found. Install it first:" >&2
		echo "  curl -fsSL https://claude.ai/install.sh | bash" >&2
		exit 1
	fi
fi

PROJECT_DIR="${1:-$PWD}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

# These disable the feature-flag evaluation Remote Control depends on. launchd
# won't inherit them from a shell profile, but flag them if they're baked in.
for var in DISABLE_TELEMETRY DO_NOT_TRACK CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC DISABLE_GROWTHBOOK; do
	if [ -n "${!var:-}" ]; then
		echo "warning: \$$var is set in this shell; Remote Control won't start with it. Unset it in your shell profile." >&2
	fi
done

# Workspace trust must be accepted interactively once; launchd can't show the
# dialog. ~/.claude.json records trusted project paths.
if ! grep -qs "\"$PROJECT_DIR\"" "$HOME/.claude.json" 2>/dev/null; then
	echo "warning: $PROJECT_DIR doesn't appear in ~/.claude.json." >&2
	echo "         If claude has never run there, run it once in that directory," >&2
	echo "         accept the workspace trust dialog, then re-run this script." >&2
fi

CLAUDE_DIR="$(dirname "$CLAUDE_BIN")"
AGENT_PATH="$CLAUDE_DIR:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PLIST_CONTENT="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$(xml_escape "$CLAUDE_BIN")</string>
		<string>remote-control</string>
	</array>
	<key>WorkingDirectory</key>
	<string>$(xml_escape "$PROJECT_DIR")</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>$(xml_escape "$AGENT_PATH")</string>
		<key>HOME</key>
		<string>$(xml_escape "$HOME")</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>60</integer>
	<key>StandardOutPath</key>
	<string>$(xml_escape "$LOG_PATH")</string>
	<key>StandardErrorPath</key>
	<string>$(xml_escape "$LOG_PATH")</string>
</dict>
</plist>"

if [ "$DRY_RUN" = "1" ]; then
	printf '%s\n' "$PLIST_CONTENT"
	exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
launchctl unload "$PLIST_PATH" 2>/dev/null || true
printf '%s\n' "$PLIST_CONTENT" > "$PLIST_PATH"
launchctl load "$PLIST_PATH"

echo ""
echo "Loaded $LABEL for project: $PROJECT_DIR"
echo ""
echo "On your iPhone: Claude app -> Code tab -> this Mac shows with a green dot."
echo ""
echo "  status:    launchctl list | grep claude-remote"
echo "  logs:      tail -f '$LOG_PATH'   (session URL appears here)"
echo "  stop:      bash scripts/setup-remote-control.sh --uninstall"
sleep 3
launchctl list | grep "$LABEL" || {
	echo "warning: agent not listed yet; check the log above." >&2
}
tail -n 20 "$LOG_PATH" 2>/dev/null || true
