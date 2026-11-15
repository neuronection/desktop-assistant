# Main-process sizes — desktop-assistant

Ledger for the family service-cohesion law: band edge ~780, trigger
~800. Any file crossing the trigger obliges the next touching round to
*propose* split-or-why-not; declines
are legal but dated, per file, and re-proposed on touch or >20% growth
past the recorded size — an undated decline is rot, not law.

**Glob (2026-10-25): `src/main/**/*.ts`** — the main-process TS
surface. No `*.tsx` exists under `src/main` (the main process is
TS-only; renderer `.tsx` is a different surface), so the ledger is
`.ts`-only. A second evaluation scoped clause-4 adjudication to
the service-layer analog (`src/main/{services,apps,turns}/**`):
`ipc-handlers.ts` is the API layer, `ai/` the AI layer, `window.ts` UI
infra — out of the service-size law's jurisdiction, but measured and
dated here anyway as informational rows (marked by layer) so the size
gate can filter. Lines are `wc -l` measured 2026-10-25 against the
current tree; the earlier baseline's composition 1,016 is stale —
it grew to 1,097 with that work. Every over-band file gets exactly one
dated row; the ledger is record-only — no code moves (any split a decline
triggers is a declared future round).

| path | lines (dated) | accept | decline (dated, reason) |
|---|---|---|---|
| `turns/TurnManager.ts` | 1,600 (2026-10-25) | — | declined 2026-10-25: the chat orchestrator (clause 3). The move-only split already lifted `approvalGate`/`titles`/`recall`/`persist`/`notify`/`branchThreads` into siblings; the residue still fuses the turn queue + state machine with four turn-flow runners in one class (`runUnavailableFlowTurn` ~490, `runToolOnlyTurn` ~270, `runStreamTurn`, `runTurn`) plus decision-route/fall-through logging. Re-propose on the next chat-heavy round (study register-13 pattern), on touch, or +20% growth |
| `apps/sources/lifecycle.ts` | 1,191 (2026-10-25) | — | declined 2026-10-25: `ExtensionSourcesService` lifecycle orchestration (add/remove/sync/install/update/restore) fused with a ~490-line pure manifest-verification & diff toolkit (`digestTree`, `entryFileProblem`, `manifestDiff`, canonical-JSON + path-containment helpers, ~785–1191) that holds no lifecycle state. Re-propose the toolkit→sibling split on touch or +20% |
| `apps/composition.ts` | 1,097 (2026-10-25) | — | declined 2026-10-25: one `createMiniAppStack` factory fuses stack wiring with inline presentation logic (run-row mapping, report/live-card/stats view builders, error formatting) behind the 19-method `MiniAppStack` face. Re-propose thin-factory + view/mapper siblings on touch or +20% |
| `ipc-handlers.ts` | 1,691 (2026-11-15) | — | declined 2026-11-15 (informational — API layer, outside the service-law glob): one ~1,600-line `setupIpcHandlers` fuses service construction with fat inline handler bodies; the capture/HUD/dictation wiring landed here in the 0.12.0 cycle. Re-propose thin-delegate handlers (one registrar per new domain, the `src/main/ipc/` pattern) on the next IPC-surface round, on touch, or +20% |
| `ai/graphs/assistant.ts` | 980 (2026-10-25) | — | declined 2026-10-25 (informational — AI layer, outside the service-law glob): the `createAssistantRunner` factory fuses prompt assembly (`buildSystemPrompt` + guidance blocks), stream-chunk normalization, interrupt extraction and salvage. Re-propose on the next AI-layer round, on touch, or +20% |
| `window.ts` | 2,265 (2026-11-15) | — | declined 2026-11-15 (informational — UI infra), growth from 934 (+142%) in the 0.12.0 cycle: the file now owns BrowserWindow lifecycle for **eight** window kinds plus HUD docking/edge switching, the launcher hand-off queues (capture, composer text, open-with-text, open-conversation) and the live host. The single-concern accept of 2026-10-25 no longer holds. Proposed split: `speechHudWindow.ts` (drag/dock/edge, ~397–984) + `launcherEvents.ts` (pending-event queues + capture hand-off, ~1263–2056); re-propose on the next window round or +20% |
| `services/ToolAppService.ts` | 782 (2026-10-25) | accepted 2026-10-25: single concern — the tool-app aggregate; spec CRUD, the order-pinned boot pipeline and the MCP backing-server keyring/cache lifecycle mutate together (server-keyed runtime state, app-keyed blobs), so there is no seam that does not couple both halves. At band edge: re-propose on touch or +20% | — |

Inventory: 7 over-band files under `src/main/**/*.ts` at 2026-10-25 —
2 accepted, 5 declined, 0 restructured. **Re-dated 2026-11-15**: `window.ts`
and `ipc-handlers.ts` grew past +20% and lost their accept/decline standing
(both now declined with a proposed split); `services/MessageService.ts` crossed
the 800 trigger at 906 with no row — it is proposed below. Next file below
band: `renderer/chat-react/useChatSession.ts` 1,889 (renderer, outside this
ledger's `src/main` glob; its split is the dedicated state-machine refactor
recorded in the plan-78 notes).
