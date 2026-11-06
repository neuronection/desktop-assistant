# Project Status

Single source of truth for what exists and what phase we are in. Update in the
same commit as any behavior change (see `AGENTS.md`).

**Current phase: post-v0.10.0, plan set 36–48 landing.** Latest tagged
release: **v0.10.0 (2026-10-22)**. The automated gate is green with
**2,396 tests** across 250 files (`npm run verify`: prisma generate,
lint, typecheck, `verify:ext-contract`, `verify:app-pack-contract`,
vitest, `verify:extension-conformance`, build) plus the strict
AI-alignment gate. The
2026-10-21 audit wave is being executed in order: schema foundation
(36), truth sweep (37), extension platform follow-ups (38–48), with the
T2 honesty gate (47 S1) already landed.

## Plan status (26–48)

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
| 38 | Unified integrations surface | S1 done (status/tier/update truth); S2–S4 proposed |
| 39 | Tool-app preset waves | W1 done (GitHub, Google Calendar, Obsidian, Notion, Spotify); W2–W3 proposed |
| 40 | Conversation branching | done (S1 pointers/walk; S2 intents, per-branch threads, queue; S3 UI composition; S4 tree export/docs) |
| 41 | Semantic ranking execution | proposed (Embedding table landed in plan 36) |
| 42 | Notification service + inbox | S1 done (one creator, dedupe/rate/click routing); S2–S3 proposed |
| 43 | MCP resources and prompts | proposed |
| 44 | IPC schema registry | done (descriptor registry + wrapper, all channels migrated, generated preload/teardown/docs) |
| 45 | Module boundaries and naming | S1–S2 done (shared layering; move-only TurnManager split into approvalGate/titles/recall/persist/notify); S3–S5 proposed |
| 46 | Robustness and test foundation | proposed |
| 47 | T2 isolation on desktop | S1 (W0 honesty gate) done; W1+ gated on D-39 |
| 48 | Automations and connectors | design-first, gated on ADR-Gate A/B |

## What exists

| Area | Status |
|---|---|
| Launcher overlay (state machine, trace strip, palette, notices) | done |
| Desktop mode (transcript, inspector + tool catalog, export, handoff) | done |
| Turn envelope + main-owned TurnManager (broadcast, cancel, persistence) | done |
| AI gateway (LangChain.js, strict drift gate, `AiCall` audit) + agent graph with HITL approvals | done |
| Policy engine (risk classes, grants, kill switch, three-layer verification) + approval cards in both windows | done |
| Native tool catalog (read-only / state-changing / destructive, functional categories) | done |
| MCP servers & tool apps (`AppService`, presets, per-tool scopes, keyring lifecycle, health) | done |
| Command palette, app discovery, custom commands/integrations, agent bridge | done |
| Persistent memory: FTS5 search, smart merge with provenance undo | done |
| Desktop awareness, download loop, file artifacts, local docs index, TTS, usage dashboard | done |
| Scheduled prompts + scheduled report-only assessments, DST-safe scheduler | done |
| Decision models: capability slots resolved through one registry (TypeSafe System One or assigned chat model), decision points, custom rules | done |
| Translation (`/tr`, translate pad, service + LLM engines, custom languages) | done |
| Live conversation mode (full-duplex with visible downgrade, barge-in, interrupt hotkey) | code complete — manual smoke owed |
| BYOK setup wizard (provider presets, curated models, task gap-fill, review) | done |
| Mini-app packs: SDK/validator, registry, runner/run cache, reports, proposals/quarantine, windows, docs | done |
| Extension platform: vendored family contract set, git/local sources pipeline, consent echo, digest pinning, T2 sandbox seam | done |
| Schema foundation: `src/main/db/` boot, `schema.sql`, user_version head, drift wall, retention pass, envelope registry, config versioning | done |
| Conversation branching: edit/regenerate/select intents, per-branch threads, single-flight queue, variant switcher/inline editor/tree rail, full-tree export | done |
| IPC schema registry: one descriptor per channel, validating wrapper with window scope, generated preload/teardown/docs, one pattern | done |
| Packaging + tag-driven release workflow (AppImage/deb, NSIS, DMG, checksums) | done — v0.10.0 latest |
| Settings UI on `@neuronection/assistant-ui` (one tab system, axe scans exclusion-free) | done |

## Superseded

| Superseded item | Replaced by |
|---|---|
| Plan 20 decision engines (the old engine enum, the local on-device engine and weights, the LLM structured-output engine) | Plan 26 decision models: a decision model is an ordinary provider model assigned per capability slot; the old engine enum and local engine were deleted outright (2026-10-13). |
| Plan 15 `mcp:*` compat channels (standalone server config) | Tool apps (`apps:*`); the old channels and their one-time config migrations were deleted. |
| `ensureTable`/`ensureColumn` runtime DDL and the plan-36 migration 001 module | Plan 36 S5 flatten: `schema.sql` + `user_version = head`; pre-flatten profiles are refused. |
| `ai:generate-response` alternate chat path, `legacyEngineNotice`, orphan IPC channels, shadowed `src/shared/constants.ts` | Plan 37 S1 no-legacy sweep. |

## Pending on-target verification

The automated gate is green. These need a real desktop session and are still owed:

- Accessibility: keyboard-only walkthroughs (launcher, desktop, approval cards, live surfaces); focus pass on macOS/Windows (axe scans are automated and exclusion-free).
- Plan 40 S3: keyboard walkthrough of branching — edit (save/resend), regenerate, variant switcher, and the inspector branch tree in both windows; verify focus returns to the composer after cancel.
- Visual: Cinnamon/Mint opaque pass, transparent-glass pass, per-OS spot checks; flow-card + trace-strip on transparent windows.
- Real-provider E2E: screenshot Q&A, shell + approval, MCP HTTP server, multi-tool node progression, research flow with a cited report and reject path.
- Plan 15: add the Home Assistant preset on the dev OS (test connection, token flow), dim-lights turn, kill switches live.
- Plan 17 S2: long conversation + large PDF no longer ends in a provider context error (trim step visible).
- Plan 19: LibreTranslate/DeepL `/tr` with the meta line and failover; custom language turn; kill switch hides the palette row.
- Plan 26 S8: Deletion review over a real mixed directory (estimates, progress, evidence, cancel/resume), quarantine approve → restore, valid/invalid pack import, empty-quarantine danger flow.
- Plan 27/28: run card settling in the open transcript, View report from the card, launcher deep-link into Settings, live card tallies.

## Backlog

Groomed candidates, not promised: plan 17 S3 turn summarization
(privacy/cost review), plan 16 S3 turn-end memory extraction, app i18n
adoption (unblocks plan 34), semantic ranking (plan 41), notifications
(plan 42), and the plan 38–48 features whose schema reservations already
exist. Cross-platform vitest portability remains a
known gap (plan 12 §7 note).
