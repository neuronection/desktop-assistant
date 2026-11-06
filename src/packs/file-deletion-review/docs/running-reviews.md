# Running a review

**When to use.** You have a folder that might hold deletable cruft and
want a reviewed, reversible cleanup. **When NOT.** The folder is a
refused root (system paths, your home dir itself) — the run-start
validation rejects it before anything is scanned.

## Start the run

1. Open the command palette and run the pack's start command
   (**Deletion review**), or use **Run…** on the pack's Runs page in
   Settings → Apps → Mini-apps. Both open the pack's launch menu first.
2. In the launch menu, pick the folder to assess — type the path or
   use **Browse…**. Nested project folders are fine; broad roots (the
   drive root, your home directory itself) are refused by design and
   the refusal shows inline. The **read file context when deciding**
   switch is the same knob as the pack settings, remembered for the
   next launch; **Runs history** jumps straight to this pack's runs.
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

Changed your mind about a file? The item popup's **Ask again** (and the
bulk-selection **Ask again**) sends a file — or a whole selection — back
to the review queue: it shows up under **Review** again and the choice
is remembered for later runs of the same folder.

The report has three tabs. **Overview** shows the verdict-distribution
and decision-source rings with their counts, the totals line and run
progress. **Files** is the working surface — one compact row of facts
per file: the name (up to three lines) over a meta line with the
colored verdict chip, confidence bar, size and a one-line evidence
chip, plus one quick action (Keep on ask/candidate rows, Candidate on
keep rows). Sort and group controls, facet counts on the filter chips,
and the ⓘ button (or a click anywhere on the row) open a detail popup
with the full facts: the complete directory path, size, age, category,
confidence and a human "decided by" chip, the structured evidence
(deciding rule, per-question answers with confidence bars) and all
actions with Show-in-folder / Open pinned alongside. **Review** is the
ask queue for a step-by-step pass. Nothing in the report has touched
your disk yet.

The results area scrolls on its own — header, filters and the context
line stay put, so the first files are visible immediately.

The **Files** tab navigates big runs as a directory tree: expand any
folder in the rail (aggregate verdict counts + sizes come from the
main-side index, so collapsed subtrees stay summarized without
mounting thousands of rows), pick a folder via breadcrumbs, and act on
it — **Keep all / Exclude all under this folder** (with a confirmation
above 50 files; the decision wins over rules and the model on later
runs) or **Add `<dir>/**` to keep rules** — all folded into the single
breadcrumb row. Runs without subfolders skip the tree entirely and
show one compact line instead (`Root folder · N files · size · N ask`)
with the same actions inline. The table lists the folder's files paged
from main (200 per page), so huge runs never mount unbounded rows. A
**Select** toggle adds multi-select: click rows to toggle (shift-click
for ranges), select the page, and apply Keep / Candidate / Exclude to
up to 500 files at once; subtree-scale decisions go through the folder
scoping above.

## User rule lists

Pack config carries three rule lists you edit in the pack settings:

- **Keep rules** — files matching these are never deleted (they never
  even reach the model).
- **Review rules** — files matching these always get a human decision.
- **Junk rules** — files matching these join the candidate queue.

Entries are globs (`*`, `**/`, `?`); a glob without a slash matches the
file name only. An entry may carry a minimum age as a `:days` suffix —
`*.log:30` fires only for files at least 30 days old, `drafts/**:90`
on keep rules keeps files only for their first 90 days. Keep rules
outrank junk rules; the sensitive-file baseline outranks everything.

The pack settings page grows a **Rules** editor for these lists:
pattern chips with add/remove/reorder (list order is the decision
order), one-click common patterns, and an **Explain a path** simulator
— type a path with size and age and it prints the full rule trace:
which rule decides, in which list, and why every other rule was
skipped. A **What would this change?** preview replays your draft
lists over the last run's items before you save, so rule edits are
consequences-first.

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
