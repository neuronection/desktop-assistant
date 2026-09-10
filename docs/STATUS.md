# Project Status

Single source of truth for what exists and what phase we are in. Update in the
same commit as any behavior change (see `AGENTS.md`).

**Current phase: public beta.** The Neuronection family migration is
complete (identity, verification gate, keyring secrets, LangChain gateway with the
strict drift gate, React/Tailwind renderer on `@neuronection/assistant-ui`, CI,
tag-driven releases). The first tagged release shipped as v0.1.0 on 2026-09-08.

## What exists

| Area | Status |
|---|---|
| Launcher overlay (state machine, trace strip, more-menu, notices) | done |
| Desktop mode (transcript, inspector + tool catalog, export, handoff) | done |
| Turn envelope + TurnManager (broadcast, cancel, persistence) | done |
| AI gateway (LangChain.js, strict drift gate, `ai_calls` audit) | done |
| Agent graph (`createAgent`, token/step/wall-clock caps, HITL approvals) | done |
| Policy engine (risk classes, grants, kill switch, three-layer verification: class defaults + presets, per-tool modes, scenario rules) + approval cards (both windows) | done |
| Native tool catalog (Tier A read-only, Tier B state-changing, Tier C destructive; functional categories) | done |
| File search inside granted roots (`find_files` glob, `grep_files` content regex; symlink-skip, budgets) | done |
| Granted-roots filesystem confinement | done |
| HITL access requests: out-of-root file calls raise an approval naming the folder — once/session (in-memory) or Always (persisted to grantedRoots); no pre-picked allowlist needed | done |
| MCP servers (stdio/HTTP/SSE, keyring secrets, Tools tab) | done |
| Tools settings: defaults/presets card, compact tool rows (search + category/status/risk filters), per-tool detail (parameter table, verification editor, grant/kill switch), MCP tool browser | done |
| Web search tool (ordered provider instances: SearXNG, Brave, Tavily, Exa, Serper, Google PSE; keys in keyring, failover) | done |
| Persistent checkpointer (app-DB tables, boot prune, resume after restart) | done |
| Node-level agent telemetry (plan 13 S1–S2): `node_started`/`node_finished` derived from the LangGraph stream (`model_request`/`tools`/middleware names, `resumed` checkpoint-replay marking), `TurnEvent.node` envelope payload, node-derived trace steps | done |
| Flow UI (plan 13 S3–S4): desktop `FlowStatusCard` for multi-step turns (ApprovalCard in the detail slot, cancel via `ai:turn-cancel`), node-aware launcher TraceStrip with `resumed` badge; desktop + launcher axe scans exclusion-free | done |
| assistant-ui 0.29.1 (empty-state ARIA fix landed upstream via desktop-found bug, `6c8882c`) | done |
| Memory (plan 12 S1): `Memory` table + MemoryService (deterministic dedupe, keyword search, capped recall), `memory_save/list/search/forget` tools in a new `memory` category, turn-start `[Memory context]` injection + Context trace marker gated on `behavior.memoryContext`, Memories manager (Settings → Tools) with undo | done |
| Desktop awareness (plan 12 S2): `window_list`/`active_window`/`process_list`/`media_controls` (per-OS matrices, graceful degrade), `screen_capture` region + window modes; selection insert = opt-in composer button (X11 primary read, no keystroke injection), opt-in clipboard watcher chip on summon; `clipboard_read` tool asks before every read (privacy default) | done |
| Slash commands (`/screenshot`, `/shell`, `/open`) | replaced by the command palette (plan 14 S2): catalog-driven resolution with the same muscle memory |
| Command layer foundations (plan 14 S1): shared command model + parser/resolver/templates + safe calculator, `CommandService` (native tools + builtins catalog, builtin execution, attribution for direct tool calls), `CommandInvocation` history with retention, `commands:*` IPC, `commands` config section | done |
| Command palette UI (plan 14 S2): in-flow launcher palette, tiered field ranking (keyword → title → keywords → description → category; library fuzzy scorer within a tier, recency boost tier-confined) over one mixed results list — category order only breaks ties, config-save broadcast refreshes the open palette + submit loads the catalog on demand, pinned/recent/suggested groups, keyboard nav (↑↓/Enter/Tab/Esc), live calculator + clipboard, mid-turn rejection notice, Ctrl+K + first-run hint, axe-scanned | done |
| App discovery (plan 14 S3): XDG/flatpak/snap + macOS bundles + Windows Start-Menu scans with mtime caching, sanctioned launch mechanisms, lazy raster-only icon pipeline with monogram fallback, `launchEnabled`/`discovery`/`hiddenApps` controls | done |
| Web search command (plan 14 S4): `/web` inline results as clickable markdown links via provider failover, engine-URL fallback with no providers, browser-mode setting, Web palette category | done |
| Custom commands & integration packs (plan 14 S5): user tool-wrappers/prompts with placeholder templates, declarative `integration.json` manifests (zod-validated at import + boot, self-disabling), keyring `${secret:…}` header refs, main-side substitution + zod re-validation, CRUD/import channels | done |
| Settings Commands tab + palette row menu (plan 14 S6): apps/web/history/integrations cards, custom command editor, catalog list with detail modal (arg defaults applied at execution + satisfy the palette guard, aliases restore palette scope on alias-less tools, pin/hide/agent-scope), deep-linked Configure, D11 spike verdict (no third window); alias-less native tools are settings-only unless user-aliased | done |
| Agent bridge (plan 14 S7): agent-scoped commands as LangChain tools via `command-tools.ts`, risk-mapped into the policy engine with approval cards intact, `source: 'agent'` history, kill-switch and scope enforcement at the seam | done |
| Desktop-window palette, `Open Command Palette` global hotkey (unassigned by default), degrade walkthrough recorded, MCP-palette verdict deferred (agent-invocable already; see plan 14 §8) | done |
| Mini-app mode (plan 14 §9): Calculator takes over the launcher input (live result, Enter copies, accent border + mode bar, Esc/✕ exits); registry ready for file-search/unit/timer modes | done — follow-up modes (files, unit conversion) tracked in plan 14 §9 |
| Settings (general, API, Tools, hotkeys) | done |
| AI settings trio (providers + connection test, ModelRegistry with caps/reasoning tuning, task assignments `chat`/`titles`/`stt`, auto-titles) | done |
| STT as a task assignment (audio-capable registry model + provider keyring secret; dedicated STT provider config removed) | done |
| Voice input: VAD-gap live interim transcription + Voice Input settings (enable, language, phrase gap, mic gain, send interval) | done |
| Voice auto-send: voiceEndpoint task assignment judges dictated phrases, auto-sends completed ones (strict verdict, fail-closed) | done |
| Packaging (electron-builder configs, tag-driven release workflow: all-platform smoke, dual-arch macOS, checksums, prerelease handling) | done — v0.1.0 shipped 2026-09-08 (first tagged family release) |

## Pending on-target verification

The automated gate (`npm run verify`: lint, typecheck, 586 tests, build; strict
AI-alignment drift gate) is green. These need a real desktop session and are tracked
here:

- Accessibility: keyboard-only walkthroughs (launcher + desktop + approval cards + live flow surfaces); focus-management pass on macOS/Windows (axe scans are wired and exclusion-free in the automated gate).
- Visual: Cinnamon/Mint opaque pass, transparent-glass pass, per-OS spot checks; flow-card + trace-strip appearance on transparent windows.
- E2E with a real provider: screenshot Q&A turn, shell turn with approval, MCP HTTP
  server against a real remote endpoint, multi-tool turn showing live node progression in both windows.
- Manual smoke owed by plan 13 S4: summon → tool turn → Escape ladder.
- Manual smoke owed by plan 14 S2: palette summon → `/` flows (screenshot turn with approval card, /calc copy, /files with a granted root) on the dev OS; window grows/shrinks with the palette on transparent + opaque passes; Escape ladder intact with the palette open.
- Packaged smoke boot covering both windows.

## Backlog

Groomed candidates: automation (scheduled prompts, quick actions,
OS-notification approvals), local-docs RAG, TTS replies, per-conversation
personas, node-outcome persistence (`GraphNodeRun`), the reference
research-flow graph, model routing, tool-usage dashboard. Nothing there is
promised.
