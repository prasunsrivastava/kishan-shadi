#!/usr/bin/env bash
# Runs the daily suggestion search with Claude Code on this laptop.
# Schedule it once a day (see CLAUDE.md, "Daily run"). The laptop must be awake,
# and Chrome must be open if you use Claude in Chrome.
#
# Check the flags with `claude --help` after Claude Code updates. If you use the
# agent-browser command instead of Claude in Chrome, remove --chrome and keep the
# agent-browser entries in ALLOWED.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p worker/logs worker/tmp
LOG="worker/logs/$(date +%F).log"

git pull --ff-only -q || echo "git pull failed, using the local copy" >> "$LOG"

ALLOWED=(
  "Read"
  "Write(worker/tmp/**)"
  "Bash(python3 worker/sb.py:*)"
  "mcp__claude-in-chrome"
  "Bash(agent-browser:*)"
  "Bash(npx agent-browser:*)"
)

{
  echo "=== Run started $(date)"
  claude -p "$(cat worker/PROCESS_SUGGESTIONS.md)" --chrome --allowedTools "${ALLOWED[@]}"
  echo "=== Run ended $(date)"
} >> "$LOG" 2>&1

# Remove photos and temporary files older than 14 days.
find worker/photos worker/tmp -type f -mtime +14 -delete 2>/dev/null || true
