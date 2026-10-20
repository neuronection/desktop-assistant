#!/usr/bin/env bash
# One-command demo tour capture for Desktop Assistant.
#
#   ./scripts/ui-capture/run-demo-capture.sh              # all scenes + GIF
#   ./scripts/ui-capture/run-demo-capture.sh --scene launcher-ask
#
# Starts everything a reproducible capture needs, then cleans up only what
# it started:
#   - vite (reused when :3300 is already serving)
#   - mock-translate (:8333), mock-assistant (:8334), mock-search (:8335)
#   - electron . --demo --demo-fresh --remote-debugging-port=9222
#   - ./scripts/capture_ui.sh "$@"
#
# A fresh demo workspace keeps the story deterministic (one clean chat, no
# stale turns); the mocks make the assistant answer, run web_search against
# local results, and translate without a provider key or network.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VITE_PORT="${VITE_PORT:-3300}"
CDP_PORT="${DA_CDP_PORT:-9222}"
MOCK_TRANSLATE_PORT="${MOCK_TRANSLATE_PORT:-8333}"
MOCK_ASSISTANT_PORT="${MOCK_ASSISTANT_PORT:-8334}"
MOCK_SEARCH_PORT="${MOCK_SEARCH_PORT:-8335}"

VITE_PID=""
VITE_GROUP=""
MOCK_PIDS=()
ELECTRON_PID=""
ELECTRON_GROUP=""

cleanup() {
  if [[ -n "$ELECTRON_PID" ]]; then
    if [[ -n "$ELECTRON_GROUP" ]]; then
      kill -- "-$ELECTRON_GROUP" 2>/dev/null || true
    else
      kill "$ELECTRON_PID" 2>/dev/null || true
    fi
    wait "$ELECTRON_PID" 2>/dev/null || true
  fi
  for pid in "${MOCK_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  if [[ -n "$VITE_PID" ]]; then
    if [[ -n "$VITE_GROUP" ]]; then
      kill -- "-$VITE_GROUP" 2>/dev/null || true
    elif kill -0 "$VITE_PID" 2>/dev/null; then
      kill "$VITE_PID" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT INT TERM

wait_for_url() {
  local url="$1" label="$2" attempts="${3:-80}"
  for ((i = 0; i < attempts; i++)); do
    if curl -fsS -o /dev/null -m 2 "$url" 2>/dev/null; then
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

if port_open "$CDP_PORT"; then
  echo "❌ port $CDP_PORT is already serving — close the running app/demo first." >&2
  exit 1
fi
for port in "$MOCK_TRANSLATE_PORT" "$MOCK_ASSISTANT_PORT" "$MOCK_SEARCH_PORT"; do
  if port_open "$port"; then
    echo "❌ port $port is already in use — stop the other demo service first." >&2
    exit 1
  fi
done

echo "→ Building the main process…"
npm run build:main-dev >/dev/null

if ! port_open "$VITE_PORT"; then
  echo "→ Starting vite on :$VITE_PORT"
  if command -v setsid >/dev/null 2>&1; then
    setsid env VITE_PORT="$VITE_PORT" npm run dev:renderer >/tmp/desktop-assistant-vite.log 2>&1 &
    VITE_PID=$!
    VITE_GROUP="$VITE_PID"
  else
    VITE_PORT="$VITE_PORT" npm run dev:renderer >/tmp/desktop-assistant-vite.log 2>&1 &
    VITE_PID=$!
  fi
  wait_for_url "http://localhost:$VITE_PORT" "vite"
fi

echo "→ Starting demo services (translate :$MOCK_TRANSLATE_PORT, assistant :$MOCK_ASSISTANT_PORT, search :$MOCK_SEARCH_PORT)"
MOCK_TRANSLATE_PORT="$MOCK_TRANSLATE_PORT" node scripts/ui-capture/mock-translate.mjs >/tmp/desktop-assistant-mock-translate.log 2>&1 &
MOCK_PIDS+=("$!")
MOCK_ASSISTANT_PORT="$MOCK_ASSISTANT_PORT" node scripts/ui-capture/mock-assistant.mjs >/tmp/desktop-assistant-mock-assistant.log 2>&1 &
MOCK_PIDS+=("$!")
MOCK_SEARCH_PORT="$MOCK_SEARCH_PORT" node scripts/ui-capture/mock-search.mjs >/tmp/desktop-assistant-mock-search.log 2>&1 &
MOCK_PIDS+=("$!")
sleep 1

echo "→ Launching the demo app (fresh workspace) on :$CDP_PORT"
if command -v setsid >/dev/null 2>&1; then
  setsid env DESKTOP_ASSISTANT_OPAQUE="${DESKTOP_ASSISTANT_OPAQUE:-1}" \
    npx electron . --remote-debugging-port="$CDP_PORT" --demo --demo-fresh >/tmp/desktop-assistant-demo.log 2>&1 &
  ELECTRON_PID=$!
  ELECTRON_GROUP="$ELECTRON_PID"
else
  DESKTOP_ASSISTANT_OPAQUE="${DESKTOP_ASSISTANT_OPAQUE:-1}" \
    npx electron . --remote-debugging-port="$CDP_PORT" --demo --demo-fresh >/tmp/desktop-assistant-demo.log 2>&1 &
  ELECTRON_PID=$!
fi
wait_for_url "http://localhost:$CDP_PORT/json/version" "electron CDP"

echo "→ Capturing the tour…"
./scripts/capture_ui.sh "$@"
