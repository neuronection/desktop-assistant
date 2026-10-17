# Mini-apps troubleshooting

Pack problems and their fixes, symptom by symptom — the using seat. For
developer-grade diagnostics (CLI validation, DB rows, audit tables) see
the [developer diagnostics](../dev/sdk/troubleshooting-and-faq.md) page;
for the safety model [What a pack can never do](mini-apps-safety.md).

## Packs that switch themselves off

| Symptom | Cause | Fix |
|---|---|---|
| Pack card shows **Disabled — reason** | the pack stopped validating: its file references something this app version doesn't know, its apiVersion fell outside the supported window (e.g. after an app downgrade), or its stored content no longer matches the digest you installed | read the reason on the card — it names the exact problem; re-import a fixed version (the new file must raise its version) |
| Imported pack disappeared after you removed its source | removing a source **parks** its packs — disabled, flagged, nothing deleted | the pack's card stays in the sources area; restore it (it stays disabled until you switch it on) or remove it properly |
| Source flagged **degraded** | the pinned content changed underneath you — the bytes you consented to no longer match | nothing refetches until you verify and re-consent; check the source (was the tag force-pushed?), then re-confirm or drop the source |
| Update asks for consent again | the update grows the pack — new capabilities or changed settings schema (the browser-permission model) | read the diff in the dialog; confirm to apply, refuse to stay on the pinned version |
| **Enable mini-apps** off | the master switch disables every pack at once | flip it back on (each pack's own switch is remembered) |
| Pre-installed app gone after removing it | removal of bundled packs is permanent across restarts by design | **Restore pre-installed apps** on the sources/mini-apps view brings them back |

## Runs

| Symptom | Cause | Fix |
|---|---|---|
| **Run…** refuses a folder | system folders, your home itself and other over-broad locations are refused (with the reason) | pick a real subfolder |
| Run paused — "N items pending, resume?" | budget or rate limit paused it cleanly | resume later; everything already decided is cached and never re-paid |
| Resuming refused | the pack's version, your settings, or the assigned decision model changed since the run | start a new run (the old one stays in history) |
| Re-running an unchanged folder costs nothing | that's the cache working — unchanged files keep their verdicts | nothing to fix |
| Live card stuck while the app was closed | host death closes runs as *interrupted* on next boot | resume or re-run; it is never counted as the pack's failure |
| Cost higher than the estimate | the estimate covers the files rules couldn't decide; big changes can move it | the finished report shows actual calls + tokens from the local audit log |

## Quarantine and reports

| Symptom | Cause | Fix |
|---|---|---|
| File not quarantined after approval | it changed after the assessment — execution re-checks every file and drops changed ones back to *ask* | re-run; that is the safety working |
| Restore landed as `name.restore-1` | the original location was occupied — restore never overwrites | keep both, or sort out the duplicate yourself |
| Quarantined items vanished after ~30 days | retention prunes old quarantine copies on boot | the only automatic cleanup; "empty quarantine" is the manual, explicit purge |
| **Open in window** just focuses an existing window | one window per pack, by design | — |
| Window closed by itself | the pack was disabled/removed, mini-apps switched off, or the app quit | expected teardown; reopen from the report |

## Sandboxed (code) packs

| Symptom | Cause | Fix |
|---|---|---|
| Pack disabled with a `sandbox: …` reason | its sandbox crashed, was watchdog-killed, or failed its content check — the pack switches itself off; the app and other packs are unaffected | fix/re-import the pack (a fresh consented import is the only re-arm) |
| Command answers "budget" | the pack hit its call/size limits | wait, or tighten/retune under the pack's settings; limits are there to bound misbehaving code |

## FAQ

**Is an imported pack safe because it was validated?** Validation checks
*shape* — the pack does what it declares and nothing else. It is not a
judgment of whether the task is useful or the thresholds sensible. Data
packs can only do what you see; code packs are additionally sandboxed, and
the consent dialog says exactly what that does and does not mean.

**Where is everything stored?** Pack installs live under your app data
folder (`mini-apps/…`), runs and audits in the app's local database,
source credentials in the encrypted key store — never in a pack, never in
plain files.

**I deleted a pack — where did its runs go?** Runs and reports stay in
history; removal removes the pack (its surfaces, commands, settings), not
the record of what it did.
