#!/usr/bin/env bash
# Playwright E2E smoke (plan 46 S3): drives the REAL app over the demo
# harness — fresh demo workspace, local scripted assistant/search mocks,
# zero network. Two paths: launcher turn (approval → persistence) and
# settings provider-form validation.
#
#   npm run smoke:e2e
#
# Starts what a reproducible run needs, then cleans up only what it
# started (mirrors run-demo-capture.sh; the smoke must not change
# capture behavior):
#   - main build (build:main-dev) so dist/main is current
#   - vite (reused when :3300 is already serving)
#   - mock-assistant (:8334), mock-search (:8335)
#   - `playwright test` (each spec boots its own electron --demo instance)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VITE_PORT="${VITE_PORT:-3300}"
MOCK_ASSISTANT_PORT="${MOCK_ASSISTANT_PORT:-8334}"
MOCK_SEARCH_PORT="${MOCK_SEARCH_PORT:-8335}"

VITE_PID=""
MOCK_PIDS=()

cleanup() {
  for pid in "${MOCK_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  if [[ -n "$VITE_PID" ]]; then
    kill "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

wait_for_url() {
  local url="$1" label="$2" attempts="${3:-80}"
  for ((i = 0; i < attempts; i++)); do
    # Any HTTP answer (even 404 from the mock root) proves the port serves.
    if curl -s -o /dev/null -m 2 "$url" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  echo "❌ $label did not become reachable: $url" >&2
  return 1
}

port_open() {
  curl -s -o /dev/null -m 1 "http://127.0.0.1:$1" 2>/dev/null
}

if port_open "$MOCK_ASSISTANT_PORT" || port_open "$MOCK_SEARCH_PORT"; then
  echo "❌ a demo mock port is already in use — stop the other demo service first." >&2
  exit 1
fi

echo "→ Building the main process…"
npm run build:main-dev >/dev/null

if ! port_open "$VITE_PORT"; then
  echo "→ Starting vite on :$VITE_PORT"
  VITE_PORT="$VITE_PORT" npm run dev:renderer >/tmp/desktop-assistant-smoke-vite.log 2>&1 &
  VITE_PID=$!
  wait_for_url "http://localhost:$VITE_PORT" "vite"
else
  echo "→ Reusing the vite already serving :$VITE_PORT"
fi

echo "→ Starting demo mocks (assistant :$MOCK_ASSISTANT_PORT, search :$MOCK_SEARCH_PORT)"
MOCK_ASSISTANT_PORT="$MOCK_ASSISTANT_PORT" node scripts/ui-capture/mock-assistant.mjs >/tmp/desktop-assistant-smoke-assistant.log 2>&1 &
MOCK_PIDS+=("$!")
MOCK_SEARCH_PORT="$MOCK_SEARCH_PORT" node scripts/ui-capture/mock-search.mjs >/tmp/desktop-assistant-smoke-search.log 2>&1 &
MOCK_PIDS+=("$!")
wait_for_url "http://127.0.0.1:$MOCK_ASSISTANT_PORT" "mock-assistant" 40
wait_for_url "http://127.0.0.1:$MOCK_SEARCH_PORT" "mock-search" 40

echo "→ Running the Playwright smoke…"
npx playwright test "$@"
