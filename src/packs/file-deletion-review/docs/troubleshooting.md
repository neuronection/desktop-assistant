# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Run refuses the folder at start | Refused root: system paths (`/`, `/usr`, `/var`, …), your home directory itself, the app's data dir, or a symlinked/mount-point root | Pick a nested project folder; symlinked roots are rejected by design — use the real path |
| Report shows far fewer files than the folder holds | Scan caps (`fileCap`, `maxDepth`) or `excludeGlobs` trimmed the walk; the totals say so honestly (`scan truncated`) | Narrow the folder, or split the run; the pack's caps are manifest-declared |
| Almost everything lands on *ask* | Your `freshDays` window is large, or the decision engine is unconfigured (questions fail ⇒ fail-closed to *ask*) | Check Tools → decision engine assignment; tighten *Keep files modified within* |
| Run stops in *paused* | Model budget or rate limit exhausted — a resumable stop, not a failure | Resume from the run card; consider a smaller folder or a cheaper engine |
| *not-ready* on the pack card | The `decision` capability has no engine assigned | Assign a decision engine in settings; rule-only verdicts still work but residual items stay *ask* |
| Quarantine item cannot restore | Original path now occupied | Restore lands as `<name>.restore-<n>` — check the quarantine manager for the suffixed copy |
| Quarantined file gone after a month | Retention prune (default 30 days) — the only automatic deletion the pack performs | Restore before the window; raise per-pack retention if this bites |
| Verdict differs from last run on the same file | The file changed (fingerprint mismatch) or config changed (configHash keys verdict validity) | Expected behavior — verdicts never transfer across content or config |
