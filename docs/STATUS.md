# Project Status

Single source of truth for what exists and what phase we are in. Update in the
same commit as any behavior change (see `AGENTS.md`).

**Current phase: 0.11.0 release-readiness hardening.** Latest tagged
release: **v0.10.0 (2026-10-22)**; the last public GitHub release is
**v0.9.0**. Plans 36–66 landed (64 is proposed/gated). The automated gate
is green with **3,486 tests** across 351 files (`npm run verify`: prisma
generate, lint, typecheck, contract gates, **coverage floors**, vitest,
`verify:extension-conformance`, build, preload sandbox) plus the strict
AI-alignment gate. Release-readiness work landed the upgrade-path lift,
packaged-catalog smoke, update integrity/consent, calendar setup/bind/
refresh correctness, the HUD card click and the speech/HUD robustness
pass; the website version-API deploy remains external.

## Plan status (26–66)

| Plan | What it is | Status |
|---|---|---|
| 26 | Decision models (assignments replace the old engine enum) + mini-app packs (ADR-0029/0032) | done |
| 27 | Run card reopens the report; deep links from both windows | done |
| 28 | Live run cards in chat (+ 28b parallel item decision) | done |
| 29 | Run-stats dashboard | done |
| 30 | Manifest JSON Schema export + import pre-check | done |
| 31 | Renderer hygiene + report pagination | done |
| 32 | Tier-2 code packs + extension contract/sources pipeline (ADR-0030/0040) | done |
| 33 | Scheduled recurring assessments (report-only) | done |
| 34 | Pack i18n negotiation / chaptered doc sets | parked on app i18n adoption (docs sets + contract gates landed) |
| 35 | Visual tour storyboard | done |
| 36 | Schema foundation: one schema, one boot path, envelopes, config versioning, drift wall, flatten | done (S1–S5) |
| 37 | Truth sweep: no-legacy, docs truth, drift gates, release | done (S1–S4; v0.10.0 cut) |
| 38 | Unified integrations surface | done (S1 truth; S2 kit adoption; S3 umbrella vocabulary/settings-map; S4 parity) |
| 39 | Tool-app preset waves | done (W1: GitHub, Google Calendar, Obsidian, Notion, Spotify; W2: Nextcloud, Jellyfin, qBittorrent, Pi-hole, Frigate; W3: Slack, Discord, GitLab, PostgreSQL insights, Prometheus, Todoist, Browser pilot) |
| 40 | Conversation branching | done (S1 pointers/walk; S2 intents, per-branch threads, queue; S3 UI composition; S4 tree export/docs) |
| 41 | Semantic ranking execution | done (S1 gateway embed; S2 EmbeddingService; S3 fusion + zero-drift golden; S4 picker/docs) |
| 42 | Notification service + inbox | done (S1 one creator, dedupe/rate/click routing; S2 Settings inbox, launcher notice parity, tray badge, axe scans; S3 `notify` read-only + dashboard attribution + docs) |
| 43 | MCP resources and prompts | done (S1 client methods + hostile fixtures; S2 Apps-tab Resources/Prompts + exposure toggle + counts; S3 prompt palette rows + `mcp_resource` + audit; S4 docs) |
| 44 | IPC schema registry | done (descriptor registry + wrapper, all channels migrated, generated preload/teardown/docs) |
| 45 | Module boundaries and naming | done (S1 layering; S2 TurnManager split; S3 CommandService split; S4 tab/component splits; S5 ToolAppService naming) |
| 46 | Robustness and test foundation | done (S1 crash/permission posture; S2 service suites + coverage; S3 Playwright smoke; S4 docs/STATUS) |
| 47 | T2 isolation on desktop | S1 (W0 honesty gate) done; W1+ gated on D-39 |
| 48 | Automations and connectors | design-first, gated on ADR-Gate A/B |
| 52 | Files-tab information design | done |
| 53 | Pack launch menu | done |
| 54 | Run telemetry and one run-action row | done |
| 55 | Deletion-review decision presets + settings descriptions | done |
| 56 | Stream display pacing (paced word/phrase reveal) | done |
| 57 | OpenAI wire transport fix (completions endpoint owns the wire) | done |
| 58 | Speech bus: selection TTS + speaking HUD, one bus owner, pause/resume, content-addressed audio cache, recent-speech replay | done (S1–S7) — OS-hotkey/manual matrix smokes owed |
| 59 | Shortcuts sheet (`Ctrl+/`): every accelerator in one overlay | done |
| 60 | Speech voice: profile presets + manual names, preview, keyless local, capability-gated speed | done (S1–S5) |
| 61 | Hidden live host: live runs in a hidden window, HUD presence only | done |
| 62 | One visible HUD surface; launcher wins | done |
| 63 | Live HUD captions and approval handoff | done |
| 64 | Wake word / voice activation | proposed, gated on engine + licence decision |
| 65/66 | Hub: quick-actions popover, text dock, mode-based control manifest, Studio sizes/Custom, right-click HUD menu | done |

## What exists

| Area | Status |
|---|---|
| Launcher overlay (state machine, trace strip, palette, notices) | done |
| Stream display pacing (paced word/phrase reveal, transient fade, markdown block settle) | done |
| Desktop mode (transcript, inspector + tool catalog, export, handoff) | done |
| Turn envelope + main-owned TurnManager (broadcast, cancel, persistence) | done |
| AI gateway (LangChain.js, strict drift gate, `AiCall` audit) + agent graph with HITL approvals | done |
| Policy engine (risk classes, grants, kill switch, three-layer verification) + approval cards in both windows | done |
| Native tool catalog (read-only / state-changing / destructive, functional categories) | done |
| MCP servers & tool apps (`ToolAppService`, presets, per-tool scopes, keyring lifecycle, health) | done |
| Command palette, app discovery, custom commands/integrations, agent bridge | done |
| Persistent memory: FTS5 search, smart merge with provenance undo | done |
| Desktop awareness, download loop, file artifacts, local docs index, TTS, usage dashboard | done |
| Scheduled prompts + scheduled report-only assessments, DST-safe scheduler | done |
| Selection speech: main-owned `SpeechService` bus, dedicated HUD overlay (card / edge knob / dot styles, live-session presence), `speech-cache:` audio cache, pause/resume from every surface, recent-speech replay | done (automated e2e; OS-hotkey manual smokes owed) |
| Hub dock: mode-based control rail (speech Pause/Stop, dictation Send/Stop, live Interrupt/End), autonomous dictation into **Voice questions**, response hover Copy, selection Translate/Speak, HUD sizes/Custom, right-click HUD menu, quick-actions popover, edge drag/switching; dot action strip with its own button config; session-only card; mini bar removed | done |
| Speech voice: provider/model profiles (OpenAI, Gemini, Piper, Kokoro, generic), presets + manual names, bus preview, keyless local servers, capability-gated speed | done |
| Decision models: capability slots resolved through one registry (TypeSafe System One or assigned chat model), decision points, custom rules | done |
| Translation (`/tr`, translate pad, service + LLM engines, custom languages) | done |
| Calendar accounts: bring-your-own public OAuth client, bind/reconnect/revoke, list/search/create/move with approval, audit rows, degraded refresh with backoff | code complete — real-provider smoke owed |
| Update checks + installer: stable/beta channel, version API, checksum-verified wizard, AppImage in-place, explicit restart | code complete — live API deploy + per-OS wizard smoke owed |
| Live conversation mode (full-duplex with visible downgrade, barge-in, interrupt hotkey) | code complete — manual smoke owed |
| BYOK setup wizard (provider presets, curated models, task gap-fill, review) | done |
| Mini-app packs: SDK/validator, registry, runner/run cache, reports, proposals/quarantine, windows, docs | done |
| Extension platform: vendored family contract set, git/local sources pipeline, consent echo, digest pinning, T2 sandbox seam | done |
| Schema foundation: `src/main/db/` boot, `schema.sql`, user_version head, forward-only lift ladder (v0.9/v1 → head 2), drift wall, retention pass, envelope registry, config versioning | done |
| Conversation branching: edit/regenerate/select intents, per-branch threads, single-flight queue, variant switcher/inline editor/tree rail, full-tree export | done |
| IPC schema registry: one descriptor per channel, validating wrapper with window scope, generated preload/teardown/docs, one pattern | done |
| Packaging + tag-driven release workflow (AppImage/deb, NSIS, DMG, checksums) | done — v0.10.0 latest |
| Settings UI on `@neuronection/assistant-ui` (one tab system, axe scans exclusion-free) | done |

## Superseded

| Superseded item | Replaced by |
|---|---|
| Plan 20 decision engines (the old engine enum, the local on-device engine and weights, the LLM structured-output engine) | Plan 26 decision models: a decision model is an ordinary provider model assigned per capability slot; the old engine enum and local engine were deleted outright (2026-10-13). |
| Plan 15 `mcp:*` compat channels (standalone server config) | Tool apps (`apps:*`); the old channels and their one-time config migrations were deleted. |
| `ensureTable`/`ensureColumn` runtime DDL and the plan-36 migration 001 module | Plan 36 S5 flatten: `schema.sql` + `user_version = head`; older profiles now lift through the ladder (v0.9 and v1 → head 2), and a database above the head is refused. |
| `ai:generate-response` alternate chat path, `legacyEngineNotice`, orphan IPC channels, shadowed `src/shared/constants.ts` | Plan 37 S1 no-legacy sweep. |

## Pending on-target verification

The automated gate is green. These need a real desktop session and are still owed:

- Accessibility: keyboard-only walkthroughs (launcher, desktop, approval cards, live surfaces); focus pass on macOS/Windows (axe scans are automated and exclusion-free).
- Crash recovery (plan 46 S1): deliberate-throw walkthrough — force a renderer exception in a dev build, confirm the window shows the TEXT-keyed failure card with the reload action, and the main log carries the `[renderer-error:*]` line.
- Plan 40 S3: keyboard walkthrough of branching — edit (save/resend), regenerate, variant switcher, and the inspector branch tree in both windows; verify focus returns to the composer after cancel.
- Plan 42 S2: keyboard walkthrough of the notifications inbox — All/Unread filter, mark read / mark all read, clear-with-confirm, the deep-link buttons, and the tray badge (unread warn/error) on macOS/Windows/Linux.
- Visual: Cinnamon/Mint opaque pass, transparent-glass pass, per-OS spot checks; flow-card + trace-strip on transparent windows.
- Plan 45 S4 renderer splits (phase 12): manual pass over the split surfaces — window drag, transparency, trace strip, palette, Apps/Api tabs in both windows (the axe/suite layer proves DOM identity; this pass proves the feel).
- Real-provider E2E: screenshot Q&A, shell + approval, MCP HTTP server, multi-tool node progression, research flow with a cited report and reject path.
- Plan 15: add the Home Assistant preset on the dev OS (test connection, token flow), dim-lights turn, kill switches live.
- Plan 17 S2: long conversation + large PDF no longer ends in a provider context error (trim step visible).
- Plan 19: LibreTranslate/DeepL `/tr` with the meta line and failover; custom language turn; kill switch hides the palette row.
- Plan 26 S8: Deletion review over a real mixed directory (estimates, progress, evidence, cancel/resume), quarantine approve → restore, valid/invalid pack import, empty-quarantine danger flow.
- Plan 27/28: run card settling in the open transcript, View report from the card, launcher deep-link into Settings, live card tallies.
- Upgrade path: install the public v0.9.0 build, create history, then install 0.11.0 over it on Linux/Windows/macOS — conversations intact, schema at head 2.
- Calendar (BYO client id): register a Google desktop client + a Microsoft app, bind, list/search, create/move with approval, all-day and a Windows-time-zone event, reconnect and disconnect; unset the env and confirm the disabled Connect explanation.
- Updates: check against the live version API (404/offline/valid), then the AppImage in-place path and the per-OS wizard with a real SHA256SUMS match; remove the sums file and confirm the fail-closed refusal.
- HUD: a pinned HUD on monitor 2 survives a Settings save; dictation/working turns keep the HUD up; **Stop reply** cancels a HUD turn; the dot lands where dropped across the midpoint.

## Backlog

Groomed candidates, not promised: plan 17 S3 turn summarization
(privacy/cost review), plan 16 S3 turn-end memory extraction, app i18n
adoption (unblocks plan 34), calendar account-scoped selection, the
speech/HUD deferred items (cache-clear pinning, HUD size change during
speech, dot drop direction, the reserved dot strip) and the plan 38–48
features whose schema reservations already exist. Cross-platform vitest
portability remains a known gap (plan 12 §7 note).
