# Running a review

**When to use.** You have a folder that might hold deletable cruft and
want a reviewed, reversible cleanup. **When NOT.** The folder is a
refused root (system paths, your home dir itself) — the run-start
validation rejects it before anything is scanned.

## Start the run

1. Open the command palette and run the pack's start command
   (**Deletion review**), or start it from Settings → Apps →
   Mini-apps → the pack card's **Run…**.
2. Pick the folder to assess. Nested project folders are fine;
   broad roots (the drive root, your home directory itself) are
   refused by design.
3. The run opens in its own conversation as a live card: scan →
   classify → decide → report. Files stream in as their verdicts are
   computed.

## Read the report

Each file lands on one of three verdicts:

| Verdict | Meaning | Decided by |
|---|---|---|
| **keep** | Stays untouched | rules (exceptions, sensitive, fresh, excluded extensions) |
| **ask** | Needs a human look | zero-length/odd files or low model confidence |
| **candidate** | Proposed for quarantine | rules (build cache, junk patterns) or the decision model |

Filter by verdict, open the **evidence** drilldown on any row to see
exactly which rule matched or which answers + confidences the model
gave. Nothing in the report has touched your disk yet.

## Arm, quarantine, restore

1. **Run: arm** on the report builds the proposal — grouped by
   category, gated on confidence (items under the gate drop to *ask*).
2. Approve the card. Each item is re-validated at move time (size +
   mtime fingerprint); a file that changed since the assessment drops
   back to *ask* — the batch continues fail-soft.
3. Approved items move into
   `<userData>/mini-apps/file-deletion-review/quarantine/<runId>/`,
   mirroring their original relative paths. The report and the run
   card link to the quarantine manager, where any item can be
   restored (a conflicting original restores as
   `<name>.restore-<n>`, never overwritten).

Quarantine copies expire after the retention window (default 30 days,
per-pack config); pruning quarantine copies is the ONLY automatic
deletion this pack can ever perform.

## What to be careful at

- **Re-run before trusting an old report.** Verdicts are keyed to the
  file's fingerprint — a changed file re-asks, but a *renamed* one is
  simply a new item.
- **Excluded extensions** default to `zip-local`; extend the list in
  pack config rather than adding per-file exceptions.
- **Cancel mid-run** is safe: verdicts persist as they are computed
  and the run can be resumed (budget stops land in *paused*, never
  *failed*).
