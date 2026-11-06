# Rules & configuration

Everything in Deletion review you can tune lives on the pack's
settings page (Settings → Apps → Mini-apps → **Configure**). This page
is the reference: rule lists, glob syntax, precedence, the model's
policy input, the confidence knob, rules-only scans, bulk and
directory-scoped decisions, the tabbed report, and quarantine
destinations.

## Rule lists

Three lists shape the classification before the model is ever asked:

| List | Effect |
|---|---|
| **Keep rules** | Matching files are never deleted — they never reach the model. |
| **Review rules** | Matching files always get a human decision (verdict *ask*). |
| **Junk rules** | Matching files join the candidate queue; the model still confirms them. |

## Glob syntax

- `*` matches anything except `/`; `?` matches one character.
- `**/` matches zero or more directories: `**/__pycache__/**`.
- A glob **without a slash matches the file name only** — `*.log`
  matches `logs/app.log` too.
- Optional minimum age: append `:days`. `*.log:30` fires only for
  files at least 30 days old; `drafts/**:90` on keep rules keeps files
  only for their first 90 days.

## Precedence

Rules apply in a fixed order — **veto → keep → ask → candidate** — and
the first matching rule decides. The veto list (your exception globs,
excluded extensions) outranks everything you configure, and the
host's sensitive-file baseline (`.env*`, keys, credentials) outranks
the veto list itself: those files are never even read.

## The rules editor

The settings page renders the lists as pattern chips with
add/remove/reorder — list order is decision order. One-click common
patterns (`node_modules/**`, `*.log`, `.DS_Store`, …) are beside every
list. **Explain a path** runs your draft rules on a single path (with
size and age) and prints the full trace: which rule decides, in which
list, and why every other rule was skipped — including `:days`
reasoning. **What would this change?** replays your draft lists over
the last run's stored items and shows, per list, how many verdicts
would flip with example paths; items from older runs without stored
size/age data are counted as unverifiable rather than guessed. Saving
goes through the normal validated config path and re-keys the verdict
cache, so the next run re-decides what your new rules affect.

## The model's policy input

Your keep/review/junk lists do not just classify — they are also
copied (bounded: 40 patterns per list, 200 characters each) into the
decision model's input as an explicit keep-policy section, so its
judgment on files the rules could not decide respects your keep
semantics. Paths only — file content never rides the policy.

## Confidence knobs

- **Model confidence required to propose quarantine**
  (`candidateConfidence`, 0.5–0.99, default 0.8): the compose gate a
  model answer must pass before a file becomes a candidate. Raising it
  demotes borderline files to *ask*. The arming floor on the proposal
  itself is manifest-fixed and cannot be lowered from config.
- **Recoverability confidence required to keep without asking**
  (`keepConfidence`, 0.5–0.99, default 0.9): how sure the model must
  be that a file is regenerable before it keeps it without a human
  look.

## Policy — structured guidance for the model

The **Policy** section composes the model's per-run guidance from
grouped inputs — always keep, always review, never delete, and
per-question scoring hints (`safe`, `recoverability`) — into one
labeled, deterministic text the runner sends with every ask (capped at
2000 characters). The preview shows exactly what the model sees.

Two more input upgrades are automatic: **your past decisions become
examples** — up to 20 of your most recent overrides on the same folder
ride each ask as "the user previously decided" (sensitive paths are
never used; the count is recorded in the item's evidence and you can
turn it off). And **binary files never send mojibake**: a printable
sniff on the first 512 bytes skips content excerpts of binary files,
recorded honestly in the evidence.
- **Quarantine destination** (`quarantineDestination`): where approved
  files go — see below.

## Rules-only scans

**Scan without the model** (next to **Run…** on the runs page) starts
a run with the model budget at zero: rules classify everything they
can, and the residual lands *paused* with a pending count. Resume when
ready — resuming runs the decision model on exactly those pending
files.

## The report at a glance

- **Overview** — verdict-distribution and decision-source rings with
  counts, totals, and the reclaimable-space line (candidate bytes from
  stored item facts + the pack's quarantined bytes).
- **Files** — the working table (path, verdict with confidence bar,
  size, category, decided-by, age), sort and group controls, facet
  counts, the directory tree, multi-select, and scoped folder
  decisions.
- **Review** — the ask queue for a step-by-step pass.

## Bulk and directory-scoped decisions

Every row carries Keep / Candidate / Exclude; the **Select** toggle
adds multi-select (row clicks toggle, shift-click ranges, page
select-all, up to 500 per batch). For whole folders use the tree:
**Keep all / Exclude all under this folder** applies your decision to
every file under it (confirmed above 50 files) — the choice persists
as stored overrides and wins over rules and the model on later runs of
the same folder. **Add `<dir>/**` to keep rules** turns a folder into
a rule in one click.

## AI conveniences (all optional, all proposals)

Three optional conveniences use one bounded plumbing-model call each —
never more — under the same law as everything else: the model proposes
or describes, and nothing matters until you act on it.

- **Run digest** (default on): after a finished run, one call summarizes
  what the run found (aggregates + up to 50 sample paths, never file
  content) in a short descriptive paragraph — shown on the report's
  Overview tab, labeled AI-generated next to the exact numbers. It
  describes, never recommends, and can be turned off
  (`runDigest`). Cost: one call per run, next to the per-item decide
  calls the run already spent.
- **Rule drafting** (off by default, `ruleDrafting`): in the rules
  editor, describe the files and the model drafts glob candidates. They
  land as **draft chips** — never saved — where the Explain-a-path
  simulator and the impact preview verify them before you add one to a
  list and save it like any hand-typed rule.
- **Rule learning** (off by default, `learnRules`): a button in the
  stored-overrides manager. Deterministic pattern inference comes
  first (a common name suffix or shared folder among your kept files —
  no model needed); only when that is ambiguous does one model call
  propose globs. The suggestion is an accept/reject card; accepting
  writes it into your keep rules through the normal validated path.
  Nothing is ever learned automatically.

## Quarantine destinations

**App store** (default): approved files move into the app-managed
quarantine folder, mirroring their original paths. Restore at any time
from the quarantine manager; copies expire after the retention window
(default 30 days) — that prune is the only automatic deletion the pack
can ever perform.

**System trash** (`system-trash`): approved files go to the OS trash
(Recycle Bin, Trash, FreeDesktop `.Trash`). The app keeps a receipt
(origin path, size, timestamp) and never touches the file again —
**restore happens in your file manager; the app cannot do it**, and no
retention applies because the app never deletes anything. Platform
honesty: Linux trash is per-mount (files on mounts without a `.Trash`
may fail), Windows Recycle Bins have size quotas, and network shares
may refuse trashing entirely — a rejection stops the batch fail-soft,
already-trashed files stay trashed, and the rest drop back to *ask*.
The arm dialog states the destination before you approve, either way.
