#!/usr/bin/env bash
# Desktop Assistant — development entrypoint (uniform family interface).
#
# Bootstraps dependencies (npm) + the Prisma client and starts the whole dev
# group via `npm run dev`: vite dev server (:5173) + tsc watch (main/preload)
# + Electron, already grouped under concurrently. A single Ctrl+C stops
# everything. Main-process and renderer changes hot-reload differently:
# vite reloads the renderer, Electron must be restarted for src/main changes.
#
# Usage:
#   ./scripts/run-dev.sh                  # bootstrap + start the dev group
#   ./scripts/run-dev.sh --force          # free the vite port first
#   ./scripts/run-dev.sh --force-stop     # stop all dev processes, exit
#   ./scripts/run-dev.sh --no-bootstrap   # skip deps/prisma steps, just start
#   ./scripts/run-dev.sh --opaque         # solid window (auto on Cinnamon)
#   ./scripts/run-dev.sh --glass          # force the transparent overlay
#   ./scripts/run-dev.sh --smoke          # build + packaged-style smoke boot
#                                         # (electron --smoke, temp data dir)
#   ./scripts/run-dev.sh -h | --help      # print this help and exit
#
# Port: VITE_PORT (default 5173). Data dir override for smoke:
# DESKTOP_ASSISTANT_DATA_DIR (defaults to a fresh temp dir in --smoke).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
cd "$SCRIPT_DIR/.."
# shellcheck source=lib/dev-common.sh
source scripts/lib/dev-common.sh

VITE_PORT="${VITE_PORT:-5173}"

NO_BOOTSTRAP=false
SMOKE=false
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --force-stop)
      dc_pkill "electron .*$SCRIPT_DIR"
      dc_pkill "vite"
      dc_kill_port "$VITE_PORT"
      dc_ok "All Desktop Assistant dev processes stopped."
      exit 0
      ;;
    --force)
      dc_kill_port "$VITE_PORT"
      ;;
    --no-bootstrap) NO_BOOTSTRAP=true ;;
    --opaque) export DESKTOP_ASSISTANT_OPAQUE=1 ;;
    --glass) export DESKTOP_ASSISTANT_OPAQUE=0 ;;
    -h|--help) dc_help "$SCRIPT_PATH" ;;
    *) dc_die "unknown option: $1 (expected --force, --force-stop, --no-bootstrap, --smoke or --help)" ;;
  esac
  shift
done

if [[ "$NO_BOOTSTRAP" = false ]]; then
  dc_ensure_node_deps . npm
  dc_step "generating the Prisma client"
  npm run prisma:generate >/dev/null
  dc_ok "Prisma client ready."
fi

dc_check_port_free "$VITE_PORT" "vite dev server"

if [[ "$SMOKE" = true ]]; then
  dc_step "building production bundle + smoke boot"
  npm run verify
  export DESKTOP_ASSISTANT_DATA_DIR="${DESKTOP_ASSISTANT_DATA_DIR:-$(mktemp -d)}"
  npx electron . --smoke --no-sandbox | tee /tmp/da-smoke.log
  grep -q SMOKE_OK /tmp/da-smoke.log || dc_die "smoke boot did not report SMOKE_OK"
  dc_ok "Smoke boot OK (data dir: $DESKTOP_ASSISTANT_DATA_DIR)"
  exit 0
fi

export ELECTRON_ENABLE_LOGGING=1   # renderer console → terminal (errors are otherwise silent)
dc_info "window mode: ${DESKTOP_ASSISTANT_OPAQUE:-auto (solid on Cinnamon)} · renderer → http://localhost:$VITE_PORT"
dc_info "Electron starts once the dev server is up; Ctrl+C stops the group."
dc_info "Main-process changes need an Electron restart (renderer hot-reloads)."
npm run dev
